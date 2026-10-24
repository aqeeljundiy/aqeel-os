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
const skillsOn=a=>mayEdit(a,'skills'),TS_UNSAFE=['terminal','file','code_execution','computer_use'];   // users.mjs UNSAFE_TOOLSETS
// send(agent,on) makes the change; when(answer) says when it applies, for the toast
async function allChipFlip(b,send,label,when){const on=b.getAttribute('aria-pressed')!=='true',a=b.dataset.agent;b.disabled=true;
 try{const r=await send(a,on);S._skPer=null;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));toast(label+(on?' on for ':' off for ')+ident(a).name+' · '+when(r,on))}catch(e){fail(e)}finally{b.disabled=false}}
ACT['all-sk']=b=>allChipFlip(b,(a,on)=>put(H,prof('/skills/toggle',a),{name:b.dataset.name,enabled:on}),b.dataset.name,()=>'applies to new chats');
ACT['all-ts']=b=>allChipFlip(b,(a,on)=>put(H,prof('/tools/toolsets/'+encodeURIComponent(b.dataset.name),a),{enabled:on}),b.dataset.name,()=>'applies to new chats');
// a plugin: turning it on copies it from an agent that has it (Who can use does the same); off switches it off there
ACT['all-pl']=b=>allChipFlip(b,(a,on)=>on?post(UI,'/ui/access',{kind:'plugin',id:b.dataset.name,agent:a,on:true}):post(UI,'/ui/plugins/toggle',{agent:a,name:b.dataset.name,enabled:false}),b.dataset.name,(r,on)=>on||r?.restart_required?'applies after the agents restart':'works at once');

Object.assign(ALLVIEW,{
 async skills(p,el){const tab=S.tab.skills||'Installed';const own=()=>setActions(`<button data-act="sk-update">${icon('refresh',16)}Update all</button><button data-act="sk-learn">${icon('wand',16)}Learn a skill</button><button class="primary" data-act="sk-new">${icon('plus',16)}New skill</button>`);own();
  // New skill, Learn a skill and Update all work on the agent you chat with: every tab says so, like Find more skills
  const forMe=`<p class="hint" style="margin:0 0 12px">New skill, Learn a skill, Update all and installs go to ${esc(ident().name)}, the agent you chat with. Pick an agent under Showing for another.</p>`;
  if(tab==='Find more skills'){await PAGES._skillsOne(p,el);own();el.insertAdjacentHTML('afterbegin',forMe);return}
  if(tab==='Tool groups'){const per=await perAgent(a=>H(prof('/tools/toolsets',a)),a=>mayEdit(a));const m=new Map();
   for(const {a,d} of per)for(const t of d||[]){const x=m.get(t.name)||{...t,on:[],all:[]};x.all.push(a);if(t.enabled)x.on.push(a);m.set(t.name,x)}
   const tq=(S.tsQ||'').toLowerCase(),tall=[...m.values()];
   const rows=tall.filter(t=>!tq||[t.name,t.label,t.description].join(' ').toLowerCase().includes(tq)).map((t,i)=>allRow(i,`<span class="ic">${icon('layers',17)}</span>`,esc(t.label||t.name),esc(t.description||''),null,`<span class="aam-ags">${t.all.map(a=>mayEdit(a,TS_UNSAFE.includes(t.name)?'unsafe':'tools')?allChip('all-ts',a,t.name,t.on.includes(a)):allAv(a,t.on.includes(a))).join('')}</span>`+tsTools({...t,enabled:t.on.length>0})));
   const bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
   el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar"><div class="search${S.tsQ?' has-q':''}">${icon('search',16)}<input id="tsQ" placeholder="Search ${tall.length} tool groups" value="${esc(S.tsQ||'')}"><button class="ghost icon s-clear" data-act="ts-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div></div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}${forMe}<div class="all-view">${allSection('Tool groups',rows,tq?'No tool group matches.':'No tool groups.')}</div>`;
   // searching filters what is on screen; nothing is asked of the agents again
   $('#tsQ').oninput=e=>{const v=e.target.value.toLowerCase();e.target.closest('.search')?.classList.toggle('has-q',!!v);S.tsQ=e.target.value;el.querySelectorAll('.all-view .row').forEach(r=>{r.hidden=!!v&&!r.textContent.toLowerCase().includes(v)})};return}
  // typing in the search box reuses the last answers (up to 30 s old) instead of asking every agent again; not kept when one failed
  let per=S._skReuse&&S._skPer&&Date.now()-S._skPer.t<30000?S._skPer.d:null;S._skReuse=false;if(!per){per=await perAgent(a=>H(prof('/skills',a)),skillsOn);S._skPer=per.some(x=>!x.d)?null:{t:Date.now(),d:per}}
  const m=new Map(),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  for(const {a,d} of per)for(const s of d||[]){const x=m.get(s.name)||{...s,on:[],all:[]};x.all.push(a);if(s.enabled)x.on.push(a);m.set(s.name,x)}
  const catOf=s=>s.category||'other',cat=S.skillCat||'All';
  const q=(S.skillQ||'').toLowerCase(),all=[...m.values()].sort((x,y)=>x.name.localeCompare(y.name)),cats=[...new Set(all.map(catOf))].sort(),list=all.filter(s=>q?(s.name+' '+(s.description||'')+' '+catOf(s)+' '+pretty(catOf(s))).toLowerCase().includes(q):cat==='All'||catOf(s)===cat);
  const rows=list.map((s,i)=>allRow(i,`<span class="ic" title="${esc(pretty(s.category||'other'))}">${icon(skIcon(s.category),17)}</span>`,esc(s.name),esc(s.description||'')+(s.category?' · '+esc(pretty(s.category)):''),null,`<span class="aam-ags">${s.all.map(a=>allChip('all-sk',a,s.name,s.on.includes(a))).join('')}</span>`));
  el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar"><div class="search${S.skillQ?' has-q':''}">${icon('search',16)}<input id="skQ" placeholder="Search ${all.length} skills on all agents" value="${esc(S.skillQ||'')}"><button class="ghost icon s-clear" data-act="sk-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div><select id="skCat" style="width:auto" aria-label="Category"><option value="All">All (${all.length})</option>${cats.map(c=>`<option ${c===cat?'selected':''} value="${esc(c)}">${esc(pretty(c))} (${all.filter(s=>catOf(s)===c).length})</option>`).join('')}</select><span class="chip">${plural(per.length-bad.length,'agent')}</span></div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}${forMe}<div class="all-view">${allSection('Skills, and which agents have each on',rows,q||cat!=='All'?'No skill matches.':'No skills yet.')}</div>`;
  $('#skCat').onchange=e=>{S.skillCat=e.target.value;S._skReuse=true;PAGES.skills(p,el)};
  let t;$('#skQ').oninput=e=>{e.target.closest('.search')?.classList.toggle('has-q',!!e.target.value);clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected||route().page?.id!=='skills')return;S.skillQ=e.target.value;S._skReuse=true;PAGES.skills(p,el).then(()=>{const i=$('#skQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}})},200)}},
 async memory(p,el){setActions('');const list=(await viewAgents()).filter(a=>S.me?.admin!==false||S.me?.agents?.[a]==='owner');   // memory is for an agent's owners (users.mjs)
  if(!list.length){el.innerHTML=emptyBox('No memory to show','Only an agent’s owners see what it remembers. Pick an agent you own under Showing.');return}
  const home=a=>'/home/claude/.hermes'+(a==='default'?'':'/profiles/'+a)+'/memories/';
  const read=memRead;
  const per=await Promise.all(list.map(async a=>({a,mem:await read(home(a)+'MEMORY.md'),user:await read(home(a)+'USER.md')})));
  const n=t=>String(t||'').split(/\n\s*§\s*\n|^\s*§\s*$/m).map(x=>x.trim()).filter(Boolean).length;
  el.innerHTML=`<div class="all-view">${per.map(({a,mem,user},i)=>`<div class="panel card" ${st(i)}><h2 class="h-row"><span class="aam-h">${Access.av({id:a,name:ident(a).name},24)}${esc(ident(a).name)}</span><span class="aam-hact">${Access.owner({owner:a})}${allOpen(a,'Open')}</span></h2><p class="sub">${mem?.err||user?.err?'Couldn’t load some of its notes. <button class="link" data-act="reload">Try again</button>':n(mem)+' notes about its work · '+n(user)+' about you'+memSize('MEMORY.md',mem)+memSize('USER.md',user)}</p>
   <details class="aam-more"><summary>What it has learned</summary>${memCards(mem)}</details><details class="aam-more"><summary>What it knows about you</summary>${memCards(user)}</details></div>`).join('')}</div>`;
  // the memory service and context engine of the agent you chat with (an owner's setting, so only for them)
  const me=agentProfile()||'default';const [m,hub]=await Promise.all([H('/memory').catch(()=>null),memHub()]);if(!m||!el.isConnected)return;Pages._memInfo=m.providers||[];
  const box=document.createElement('div');box.className='aam-mem';box.innerHTML=memProvPanel(m,hub,ident(me).name)+`<p class="hint" style="margin:8px 0 0">For ${esc(ident(me).name)}, the agent you chat with. Pick an agent under Showing for another.</p>`;el.querySelector('.all-view')?.append(box);bindMemProv(box)},
 async files(p,el){setActions(`<button data-act="f-mkdir">${icon('folder',16)}New folder</button><button class="primary" data-act="f-upload">${icon('upload',16)}Upload</button>`);const list=await viewAgents();
  // a folder that does not exist yet is "Not made yet"; one that could not be read says so, with Try again
  const per=await Promise.all(list.map(async a=>{const path='/home/claude/workspaces/'+a;return {a,path,d:await H('/files'+qp({path})).catch(e=>e?.status===404||/not found|no such|does not exist/i.test(e?.message||'')?null:{err:e})}}));
  const bad=per.filter(x=>x.d?.err).map(x=>ident(x.a).name);
  const rows=per.map(({a,path,d},i)=>{const items=(d?.entries||[]).filter(f=>!f.name.startsWith('.'));
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}’s folder</b><span>${d?.err?'Couldn’t read it':d?items.length+' item'+(items.length===1?'':'s')+(items.length?' · '+items.slice(0,4).map(f=>esc(f.name)).join(', ')+(items.length>4?'…':''):''):'Not made yet'}</span><span class="acc-from" style="font-family:var(--mono)">${esc(path.replace('/home/claude','~'))}</span></div></div><div class="act">${Access.owner({owner:a})}${allOpen(a)}</div></div>`});
  el.innerHTML=`${bad.length?errLine(bad.join(', ')+(bad.length>1?'’s folders':'’s folder'),'margin:0 0 12px'):''}<div class="all-view">${allSection('Each agent’s own folder',rows,'No agents yet.')}</div><p class="hint" style="margin:14px 0 0">New folder and Upload work in ${esc(String(S.filePath||FILE_HOME).replace('/home/claude','~'))}. Open an agent’s folder to work in it.</p>`},
 async logs(p,el){setActions(`<button data-act="reload" title="Load the latest lines now">${icon('refresh',16)}Refresh</button>`);const o=S.logs||(S.logs={file:'agent',level:'ALL',component:'all',lines:200,live:true});const map={Agent:'agent',Channels:'gateway',Errors:'errors'};
  const per=await perAgent(a=>H(prof('/logs'+qp({file:o.file,lines:80}),a)));
  const lines=per.flatMap(({a,d})=>(d?.lines||[]).map(l=>({a,l:l.replace(/\n$/,'')}))).sort((x,y)=>x.l.slice(0,23)<y.l.slice(0,23)?-1:1).slice(-400),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  el.innerHTML=`<div class="all-view"><div class="toolbar">${tabs('logfile',Object.keys(map),Object.keys(map).find(k=>map[k]===o.file))}</div><p class="hint" style="margin:0 0 12px">The latest lines from every agent, oldest first. Pick one agent under Showing for filters and live updates.</p>${bad.length?`<p class="err-line" style="margin:0 0 12px">${esc(bad.join(', '))}: the log couldn’t be loaded, so ${bad.length>1?'their':'its'} lines are missing. <button data-act="reload">Try again</button></p>`:''}<div class="log" id="logBox">${lines.map(({a,l})=>logLine(l,'<b class="aam-who">'+esc(ident(a).name)+'</b> ')).join('\n')||(bad.length===per.length&&per.length?'No log could be loaded.':'Nothing logged yet.')}</div></div>`;
  const box=$('#logBox');if(box)box.scrollTop=box.scrollHeight;placePills?.();
  el.querySelector('[data-tabs=logfile]')?.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b&&map[b.dataset.tab]!==o.file){o.file=map[b.dataset.tab];ALLVIEW.logs(p,el).catch(er=>showError(el,er))}})},
 async settings(p,el){setActions(`<button data-act="cfg-raw">Raw YAML</button><button data-act="cfg-import">${icon('upload',16)}Import</button><button data-act="cfg-export">${icon('download',16)}Export</button>`);const per=await perAgent(a=>H(prof('/config',a)));
  const g=(c,k)=>k.split('.').reduce((o,x)=>o==null?undefined:o[x],c);
  const rows=per.map(({a,d},i)=>{const own=g(d,'terminal.backend')==='ssh';const bits=[modelLabel(g(d,'model.default')||g(d,'model')||''),own?'Own Linux user':'Main box user',g(d,'approvals.mode')?'Approvals: '+pretty(g(d,'approvals.mode')):'',g(d,'timezone')||''].filter(Boolean);
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}</b><span>${d?bits.map(esc).join(' · '):'Its settings couldn’t be read'}</span></div></div><div class="act">${Access.owner({owner:a})}${allOpen(a,'Change')}</div></div>`});
  const bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  el.innerHTML=`${bad.length?errLine(bad.join(', ')+(bad.length>1?'’s settings':'’s settings'),'margin:0 0 12px'):''}<div class="all-view">${allSection('Each agent’s settings',rows,'No agents yet.')}</div>`}});

PAGES._skillsOne=PAGES.skills;
for(const id of ['skills','files','memory','logs','settings']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);viewPick(await viewAgents());return ALLVIEW[id](p,el)}}
// Plugins draws its own page (people.js), which left out the Showing picker; every page with one keeps it
for(const id of ['plugins','skills','files','memory','logs','settings','mcp','keys','webhooks']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{if(!showingAll())viewPick(await viewAgents());return base(p,el,r)}}
// Connected apps and Plugins under "All agents" keep their own tabs and add button (21 Oct 2026): the Catalog and Browse
// tabs and "Add server" were gone while every agent was shown. The list tab stays the all-agents view; the other tab,
// and adding, work on the agent you chat with (the hint says so).
for(const [id,first,tabsOf,act] of [['mcp','Your servers',['Your servers','Catalog'],`<button class="primary" data-act="mcp-add">${icon('plus',16)}Add server</button>`],['plugins','Installed',['Installed','Browse'],`<button data-act="pl-rescan">${icon('refresh',16)}Rescan</button>`]]){
 const base=PAGES[id];PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);const tab=S.tab[id]||first;
  // the other tab: drawn as for the agent you chat with, the picker still saying All agents
  if(tab!==first){S.viewAll=false;try{await base(p,el,r)}finally{S.viewAll=true}viewPick(await viewAgents());el.querySelector('[data-tabs="'+id+'"]')?.insertAdjacentHTML('afterend',`<p class="hint" style="margin:0 0 12px">Installs go to ${esc(ident().name)}. Pick an agent under Showing to install on another.</p>`);return}
  await base(p,el,r);setActions(act);if(!el.querySelector('[data-tabs="'+id+'"]')){el.insertAdjacentHTML('afterbegin',tabs(id,tabsOf));placePills?.()}
  if(id==='mcp')el.insertAdjacentHTML('beforeend',`<p class="hint" style="margin:14px 0 0">Add server and Catalog add to ${esc(ident().name)}. Pick an agent under Showing to add to another.</p>`)}}
