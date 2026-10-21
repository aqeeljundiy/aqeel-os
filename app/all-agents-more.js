// "All agents" on every page with the Showing picker (20 Oct 2026), not only on apps, plugins and keys: Skills (with its
// tool groups), Files, Memory, Logs and Settings show every agent's at once, each saying whose it is. Skills and tool
// groups switch on and off per agent right here; the rest opens on the agent to change it.
for(const id of ['skills','files','memory','logs','settings'])ALL_PAGES.add(id);
const allAv=(a,on=true)=>`<span class="aam-ag${on?' on':''}" title="${esc(ident(a).name)}">${Access.av({id:a,name:ident(a).name},18)}<span>${esc(ident(a).name)}</span></span>`;
// per agent: a chip that turns the thing on or off for that agent
const allChip=(act,a,name,on)=>`<button class="aam-ag${on?' on':''}" data-act="${act}" data-agent="${esc(a)}" data-name="${esc(name)}" aria-pressed="${on}" title="${esc(ident(a).name)}: ${on?'on, click to turn off':'off, click to turn on'}">${Access.av({id:a,name:ident(a).name},18)}<span>${esc(ident(a).name)}</span></button>`;
const perAgent=async(fn,ok=()=>true)=>{const list=(await viewAgents()).filter(ok);return Promise.all(list.map(async a=>({a,d:await fn(a).catch(()=>null)})))};
// whose skills this person may manage: admins all; members the agents they own, plus those they edit when their role has skills
const skillsOn=a=>{const me=S.me||{},l=me.agents?.[a];return me.admin!==false||l==='owner'||!!l&&l!=='chat'&&(me.caps||[]).includes('skills')};
const prof=(p,a)=>p+(p.includes('?')?'&':'?')+'profile='+encodeURIComponent(a);
async function allChipFlip(b,path,body,label){const on=b.getAttribute('aria-pressed')!=='true',a=b.dataset.agent;b.disabled=true;
 try{await put(H,prof(path,a),body(on));S._skPer=null;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));toast(label+(on?' on for ':' off for ')+ident(a).name)}catch(e){fail(e)}finally{b.disabled=false}}
ACT['all-sk']=b=>allChipFlip(b,'/skills/toggle',on=>({name:b.dataset.name,enabled:on}),b.dataset.name);
ACT['all-ts']=b=>allChipFlip(b,'/tools/toolsets/'+encodeURIComponent(b.dataset.name),on=>({enabled:on}),b.dataset.name);

Object.assign(ALLVIEW,{
 async skills(p,el){const tab=S.tab.skills||'Installed';setActions('');
  if(tab==='Find more skills'){await PAGES._skillsOne(p,el);setActions('');el.insertAdjacentHTML('afterbegin',`<p class="hint" style="margin:0 0 12px">Installs go to ${esc(ident().name)}. Pick an agent under Showing to install on another.</p>`);return}
  if(tab==='Tool groups'){const per=await perAgent(a=>H(prof('/tools/toolsets',a)));const m=new Map();
   for(const {a,d} of per)for(const t of d||[]){const x=m.get(t.name)||{...t,on:[],all:[]};x.all.push(a);if(t.enabled)x.on.push(a);m.set(t.name,x)}
   const rows=[...m.values()].map((t,i)=>allRow(i,`<span class="ic">${icon('layers',17)}</span>`,esc(t.label||t.name),esc(t.description||''),null,`<span class="aam-ags">${t.all.map(a=>allChip('all-ts',a,t.name,t.on.includes(a))).join('')}</span>`));
   const bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
   el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}<div class="all-view">${allSection('Tool groups',rows,'No tool groups.')}</div>`;return}
  // typing in the search box reuses the last answers (up to 30 s old) instead of asking every agent again; not kept when one failed
  let per=S._skReuse&&S._skPer&&Date.now()-S._skPer.t<30000?S._skPer.d:null;S._skReuse=false;if(!per){per=await perAgent(a=>H(prof('/skills',a)),skillsOn);S._skPer=per.some(x=>!x.d)?null:{t:Date.now(),d:per}}
  const m=new Map(),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  for(const {a,d} of per)for(const s of d||[]){const x=m.get(s.name)||{...s,on:[],all:[]};x.all.push(a);if(s.enabled)x.on.push(a);m.set(s.name,x)}
  const q=(S.skillQ||'').toLowerCase(),all=[...m.values()].sort((x,y)=>x.name.localeCompare(y.name)),list=all.filter(s=>!q||(s.name+' '+s.description).toLowerCase().includes(q));
  const rows=list.map((s,i)=>allRow(i,`<span class="ic ${s.on.length?'blue':''}">${icon('sparkle',17)}</span>`,esc(s.name),esc(s.description||'')+(s.category?' · '+esc(pretty(s.category)):''),null,`<span class="aam-ags">${s.all.map(a=>allChip('all-sk',a,s.name,s.on.includes(a))).join('')}</span>`));
  el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar"><div class="search">${icon('search',16)}<input id="skQ" placeholder="Search ${all.length} skills on all agents" value="${esc(S.skillQ||'')}"></div><span class="chip">${plural(per.length-bad.length,'agent')}</span></div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}<div class="all-view">${allSection('Skills, and which agents have each on',rows,q?'No skill matches.':'No skills yet.')}</div>`;
  let t;$('#skQ').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected||route().page?.id!=='skills')return;S.skillQ=e.target.value;S._skReuse=true;PAGES.skills(p,el).then(()=>{const i=$('#skQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}})},200)}},
 async memory(p,el){setActions('');const list=await viewAgents();
  const home=a=>'/home/claude/.hermes'+(a==='default'?'':'/profiles/'+a)+'/memories/';
  const read=memRead;
  const per=await Promise.all(list.map(async a=>({a,mem:await read(home(a)+'MEMORY.md'),user:await read(home(a)+'USER.md')})));
  const n=t=>String(t||'').split(/\n\s*§\s*\n|^\s*§\s*$/m).map(x=>x.trim()).filter(Boolean).length;
  el.innerHTML=`<div class="all-view">${per.map(({a,mem,user},i)=>`<div class="panel card" ${st(i)}><h2 class="h-row"><span class="aam-h">${Access.av({id:a,name:ident(a).name},24)}${esc(ident(a).name)}</span>${allOpen(a,'Open')}</h2><p class="sub">${mem?.err||user?.err?'Couldn’t load some of its notes':n(mem)+' notes about its work · '+n(user)+' about you'}</p>
   <details class="aam-more"><summary>What it has learned</summary>${memCards(mem)}</details><details class="aam-more"><summary>What it knows about you</summary>${memCards(user)}</details></div>`).join('')}</div>`},
 async files(p,el){setActions('');const list=await viewAgents();
  const per=await Promise.all(list.map(async a=>{const path='/home/claude/workspaces/'+a;return {a,path,d:await H('/files'+qp({path})).catch(()=>null)}}));
  const rows=per.map(({a,path,d},i)=>{const items=(d?.entries||[]).filter(f=>!f.name.startsWith('.'));
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}’s folder</b><span>${d?items.length+' item'+(items.length===1?'':'s')+(items.length?' · '+items.slice(0,4).map(f=>esc(f.name)).join(', ')+(items.length>4?'…':''):''):'Not made yet'}</span><span class="acc-from" style="font-family:var(--mono)">${esc(path.replace('/home/claude','~'))}</span></div></div><div class="act">${allOpen(a)}</div></div>`});
  el.innerHTML=`<div class="all-view">${allSection('Each agent’s own folder',rows,'No agents yet.')}</div>`},
 async logs(p,el){setActions('');const per=await perAgent(a=>H(prof('/logs'+qp({file:'agent',lines:80}),a)));
  const lines=per.flatMap(({a,d})=>(d?.lines||[]).map(l=>({a,l:l.replace(/\n$/,'')}))).sort((x,y)=>x.l.slice(0,23)<y.l.slice(0,23)?-1:1).slice(-400);
  el.innerHTML=`<div class="all-view"><p class="hint" style="margin:0 0 12px">The latest lines from every agent, oldest first. Pick one agent under Showing for its channels and errors, filters and live updates.</p><div class="log" id="logBox">${lines.map(({a,l})=>{const e='<b class="aam-who">'+esc(ident(a).name)+'</b> '+esc(l);return / (ERROR|CRITICAL) /.test(l)?`<span class="e">${e}</span>`:/ WARNING /.test(l)?`<span class="w">${e}</span>`:e}).join('\n')||'Nothing logged yet.'}</div></div>`;
  const box=$('#logBox');if(box)box.scrollTop=box.scrollHeight},
 async settings(p,el){setActions('');const per=await perAgent(a=>H(prof('/config',a)));
  const g=(c,k)=>k.split('.').reduce((o,x)=>o==null?undefined:o[x],c);
  const rows=per.map(({a,d},i)=>{const own=g(d,'terminal.backend')==='ssh';const bits=[modelLabel(g(d,'model.default')||g(d,'model')||''),own?'Own Linux user':'Main box user',g(d,'approvals.mode')?'Approvals: '+pretty(g(d,'approvals.mode')):'',g(d,'timezone')||''].filter(Boolean);
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}</b><span>${d?bits.map(esc).join(' · '):'Its settings couldn’t be read'}</span></div></div><div class="act">${allOpen(a,'Change')}</div></div>`});
  el.innerHTML=`<div class="all-view">${allSection('Each agent’s settings',rows,'No agents yet.')}</div>`}});

PAGES._skillsOne=PAGES.skills;
for(const id of ['skills','files','memory','logs','settings']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);viewPick(await viewAgents());return ALLVIEW[id](p,el)}}
// Plugins draws its own page (people.js), which left out the Showing picker; every page with one keeps it
for(const id of ['plugins','skills','files','memory','logs','settings','mcp','keys','webhooks']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{if(!showingAll())viewPick(await viewAgents());return base(p,el,r)}}
