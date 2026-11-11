// This install, in the app (install-routes.mjs): nothing about setting up aqeelOS needs an env file.
//  - the first sign-in asks for Your address once, prefilled with the address in the browser, and checks it;
//  - System › Settings › This install: the address, the time zone, the Code and app addresses, live or test copy;
//  - Agents: says plainly when the per-agent Linux users are missing, with the one command that fixes it;
//  - Models: installs the Claude sign-in (the Claude app and the engine's plugin) with one button.
const Install={d:null,
 async load(){try{this.d=await UI('/ui/install');S.install=this.d}catch{this.d=null}return this.d},
 from:f=>({env:'Set in the environment',setting:'',default:'Not set yet'})[f]??''};

// links people open from elsewhere (invites) use Your address once it is set, else the address in this browser
function publicBase(){const a=S.install?.address;return a&&a.from!=='default'&&a.url?a.url:location.origin}

/* ---------- first sign-in ---------- */
{const base=loadMe;loadMe=async(...a)=>{await base(...a);if(S.me?.admin===false)return;const d=await Install.load();if(d?.address?.ask)setTimeout(()=>addressDialog({first:true}),600)}}

/* ---------- Your address ---------- */
function addressDialog({first=false}={}){const a=Install.d?.address||{};const pre=a.from==='default'?(a.suggest||location.origin):a.url;
 const d=drawer('Your address',`<p class="sub" style="margin-top:0">${first?'Welcome. One thing first: the':'The'} address people and services use to reach this aqeelOS. Invites, WhatsApp Business, Kirimdev and app sign-ins send people back here.</p>
  <label for="instUrl">Address</label><input id="instUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(pre||'')}" placeholder="https://ai.example.com">
  <div class="inst-check" id="instWhy" aria-live="polite"></div>`,
  `<button class="ghost" data-act="${first?'inst-later':'close'}">${first?'Later':'Cancel'}</button><button class="primary" id="instSave">Check and save</button>`);
 const inp=d.querySelector('#instUrl'),why=d.querySelector('#instWhy'),btn=d.querySelector('#instSave');let anyway=false;
 const say=(kind,text)=>{why.className='inst-check '+kind;why.innerHTML=text?`${icon(kind==='ok'?'check':kind==='bad'?'alert':'refresh',15)}<span>${esc(text)}</span>`:''};
 inp.oninput=()=>{anyway=false;btn.textContent='Check and save';say('','')};
 btn.onclick=async()=>{btn.disabled=true;say('wait','Checking that the address reaches this aqeelOS…');
  try{const r=await post(UI,'/ui/install/address',{url:inp.value,anyway});
   if(r.saved){closeLayers();toast(r.check?.ok?'Address saved and checked':'Address saved');await Install.load();if(route().page?.id==='settings')reload();return}
   say('bad',r.check?.why||'That address did not answer.');anyway=true;btn.textContent='Save anyway'}
  catch(e){say('','');fail(e)}finally{btn.disabled=false}}}
ACT['inst-later']=async()=>{closeLayers();try{await post(UI,'/ui/install/address',{later:true})}catch{}toast('You can set it any time on System › Settings')};
ACT['inst-address']=()=>addressDialog();

/* ---------- time zone: a searchable list in a dialog (no native select) ---------- */
function zoneList(){try{return Intl.supportedValuesOf('timeZone')}catch{return ['UTC','Europe/London','Europe/Amsterdam','Asia/Jakarta','Asia/Singapore','America/New_York','America/Los_Angeles','Australia/Sydney']}}
const zoneLabel=z=>z.replace(/_/g,' ').replace(/\//g,' / ');
function zoneDialog(onDone){const cur=Install.d?.timezone?.zone||'',mine=Intl.DateTimeFormat().resolvedOptions().timeZone,all=zoneList();
 const d=drawer('Time zone',`<p class="sub" style="margin-top:0">One time zone for the whole install: schedules, posting limits, backups and notices. Every agent gets it.</p>
  <input id="tzQ" type="search" placeholder="Search a city or region" autocomplete="off" aria-label="Search time zones">
  <div class="tz-list" id="tzList" role="listbox" aria-label="Time zones"></div>`,`<button class="ghost" data-act="close">Cancel</button>`);
 const list=d.querySelector('#tzList'),q=d.querySelector('#tzQ');
 const paint=()=>{const s=q.value.trim().toLowerCase().replace(/\s+/g,'_');const top=[mine,...(cur&&cur!==mine?[cur]:[])];
  const l=(s?all.filter(z=>z.toLowerCase().includes(s)):[...top,...all.filter(z=>!top.includes(z))]).slice(0,200);
  list.innerHTML=l.map(z=>`<button type="button" role="option" class="tz-opt${z===cur?' on':''}" data-z="${esc(z)}" aria-selected="${z===cur}"><span>${esc(zoneLabel(z))}</span>${z===mine?'<small>This computer</small>':z===cur?'<small>Now</small>':''}</button>`).join('')||'<p class="hint" style="padding:10px">No time zone matches.</p>'};
 q.oninput=paint;paint();setTimeout(()=>q.focus(),80);
 list.onclick=async e=>{const b=e.target.closest('.tz-opt');if(!b)return;list.querySelectorAll('.tz-opt').forEach(x=>x.disabled=true);b.classList.add('busy');
  try{const r=await post(UI,'/ui/install/timezone',{zone:b.dataset.z});closeLayers();toast('Time zone: '+zoneLabel(r.zone)+(r.pending?'. Agents follow within a minute or two.':r.failed?.length?'. Not set for '+r.failed.length+' agent(s) yet.':''));
   await Install.load();if(typeof SCHED!=='undefined'&&SCHED.tzs){for(const k of Object.keys(SCHED.tzs))SCHED.tzs[k]=r.zone;store.set('schedTzs',SCHED.tzs)}onDone?.(r.zone);if(['settings','schedules'].includes(route().page?.id))reload()}
  catch(er){list.querySelectorAll('.tz-opt').forEach(x=>x.disabled=false);b.classList.remove('busy');fail(er)}}}
ACT['inst-tz']=()=>zoneDialog();

/* ---------- Code and published-app addresses ---------- */
const HOST_TEXT={codeHost:['Code app','Where Code runs online, behind your sign-in.','code.example.com'],codePreviewHost:['Code previews','Where Code shows live previews of what it builds.','code-preview.example.com'],liveDomain:['Published apps','Apps published from Code get name.this-domain.','app.example.com']};
// the Code addresses belong to online Code only: while it is off they are not shown, and the published-app address stays
const hostRows=()=>Object.entries(HOST_TEXT).filter(([k])=>Install.d?.onlineCode?.on||!/^code/.test(k));
function hostsDialog(){const h=Install.d?.hosts||{};
 const d=drawer('Code and app addresses',`<p class="sub" style="margin-top:0">Point each address at this server in your DNS and proxy first. Changes are used from the next start of aqeelOS.</p>${hostRows().map(([k,[t,hint,ph]])=>{const v=h[k]||{};const locked=v.from==='env';
  return `<label for="ih-${k}">${esc(t)}</label><input id="ih-${k}" data-k="${k}" autocomplete="off" spellcheck="false" placeholder="${esc(ph)}" value="${esc(v.from==='default'?'':v.value||'')}" ${locked?'disabled':''}><p class="hint" style="margin:4px 0 12px">${esc(locked?'Set in the environment ('+v.env+').':hint)}</p>`}).join('')}`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="ihSave">Save</button>`);
 d.querySelector('#ihSave').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const body={};d.querySelectorAll('input[data-k]:not(:disabled)').forEach(i=>body[i.dataset.k]=i.value);
  try{await post(UI,'/ui/install/hosts',body);closeLayers();toast('Saved. Used from the next start.');await Install.load();reload()}catch(er){fail(er)}finally{b.disabled=false}}}
ACT['inst-hosts']=()=>hostsDialog();
/* ---------- the maintenance window: start, end, its time zone, and how long interrupted work is still continued ---------- */
function windowDialog(){const m=Install.d?.maintenance||{from:'00:00',to:'01:00',tz:'Asia/Jakarta',resumeHours:2};
 const d=drawer('Maintenance window',`<p class="sub" style="margin-top:0">Once a night aqeelOS updates itself and does the restarts that could wait. It no longer waits for a quiet moment: whatever a restart interrupts continues by itself right after.</p>
  <div class="mw-row"><div><label for="mwFrom">From</label><input id="mwFrom" inputmode="numeric" autocomplete="off" placeholder="00:00" value="${esc(m.from)}"></div><div><label for="mwTo">To</label><input id="mwTo" inputmode="numeric" autocomplete="off" placeholder="01:00" value="${esc(m.to)}"></div></div>
  <label for="mwTz">Time zone of the window</label><input id="mwTz" autocomplete="off" spellcheck="false" placeholder="Asia/Jakarta" value="${esc(m.tz)}"><div class="tz-list mw-tz" id="mwList" role="listbox" aria-label="Time zones" hidden></div>
  <label for="mwAge">Continue interrupted work for (hours)</label><input id="mwAge" inputmode="decimal" autocomplete="off" value="${esc(String(m.resumeHours))}"><p class="hint" style="margin:4px 0 0">Anything interrupted longer ago than this is left alone and listed on System › Health.</p>`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="mwSave">Save</button>`);
 const tz=d.querySelector('#mwTz'),list=d.querySelector('#mwList'),all=zoneList();
 // the zone is picked from the same list as the install's time zone: type to search, press one to take it
 tz.oninput=()=>{const q=tz.value.trim().toLowerCase().replace(/\s+/g,'_'),l=q?all.filter(z=>z.toLowerCase().includes(q)).slice(0,30):[];list.hidden=!l.length||(l.length===1&&l[0]===tz.value);list.innerHTML=l.map(z=>`<button type="button" role="option" class="tz-opt" data-z="${esc(z)}"><span>${esc(zoneLabel(z))}</span></button>`).join('')};
 list.onclick=e=>{const b=e.target.closest('.tz-opt');if(!b)return;tz.value=b.dataset.z;list.hidden=true};
 d.querySelector('#mwSave').onclick=async e=>{const b=e.currentTarget;b.disabled=true;
  try{const r=await post(UI,'/ui/install/maintenance',{from:d.querySelector('#mwFrom').value,to:d.querySelector('#mwTo').value,tz:tz.value.trim(),resumeHours:Number(d.querySelector('#mwAge').value)});closeLayers();toast('Maintenance window: '+r.text);await Install.load();reload()}catch(er){fail(er)}finally{b.disabled=false}}}
ACT['inst-window']=()=>windowDialog();

/* ---------- System › Settings › This install ---------- */
// what Automatic updates says: what it does, and how the last one went
const autoUpdateLine=(a,m)=>{const base=a.on?'New versions and fixes install by themselves in the maintenance window'+(m?', '+m.text:'')+'. Your skills, agents and data are not touched.':'Off: this server stays on its current version.';const l=a.last;if(!l||l.result==='current')return base;const w=ago(Math.round(l.at/1000));return base+' '+(l.result==='updated'?'Last updated '+w+'.':l.result==='refused'?'Last check, '+w+': '+l.why:'Last try, '+w+', failed: '+l.why)};
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el);await settings(p,el,r);if(gone()||S.me?.admin===false||el.querySelector('#instBox'))return;
 const d=await Install.load();if(gone()||!d?.live)return;const a=d.address,tz=d.timezone;
 const chip=(kind,t)=>`<span class="chip ${kind}">${esc(t)}</span>`;
 const addrState=a.from==='env'?chip('','Set in the environment'):a.from==='default'?chip('warn','Not set yet'):a.checkedAt?chip('ok','Checked'):chip('warn','Not checked');
 const hostLine=hostRows().map(([k,[t]])=>{const v=d.hosts[k];return `${esc(t)}: <b>${esc(v.from==='default'?'not set':v.value)}</b>`}).join(' · ');
 const box=document.createElement('div');box.className='panel card inst-box';box.id='instBox';box.style.marginBottom='16px';
 box.innerHTML=`<h2>This install</h2><p class="sub">Where people reach this aqeelOS, and the settings every agent shares.</p>
  ${fieldRow('Your address',esc(a.from==='env'?'Set in the environment (PUBLIC_URL).':'Invites, WhatsApp Business, Kirimdev and app sign-ins send people here.'),`<div class="inst-val">${a.from==='default'?`<span class="inst-unset">Not set <small>(using <span class="mono">${esc(a.url)}</span>)</small></span>`:`<span class="mono">${esc(a.url)}</span>${addrState}`}${a.from==='env'?'':'<button class="small" data-act="inst-address">Change</button>'}</div>`)}
  ${fieldRow('Time zone',esc(tz.zone?'Schedules, posting limits, backups and notices use it.':'Not chosen yet, so the server’s own zone is used ('+tz.box+').'),`<div class="inst-val"><span>${esc(tz.zone?zoneLabel(tz.zone):'Server: '+zoneLabel(tz.box))}</span><button class="small" data-act="inst-tz">Change</button></div>`)}
  ${d.onlineCode?fieldRow('Online Code',esc(d.onlineCode.on?'On: the server runs a Code workspace for people who code online.':'Off: coding happens on people’s own computers (the Build app). Publishing to Live and the agents are not affected.')+(d.onlineCode.from==='env'?' Set in the environment (ONLINE_CODE).':''),`<div class="inst-val">${toggle(d.onlineCode.on,'Online Code','id="instOc"'+(d.onlineCode.from==='env'?' disabled':''))}</div>`):''}
  ${fieldRow(d.onlineCode?.on?'Code and app addresses':'Published app address',hostLine,`<div class="inst-val"><button class="small" data-act="inst-hosts">Change</button></div>`)}
  ${d.engine&&d.engine.state!=='ok'?fieldRow('Engine',esc(ENGINE_SAY[d.engine.state]?.[0]||''),`<div class="inst-val">${chip('warn',d.engine.state==='auth'?'Needs a restart':'Not answering')}<a href="#/system/health">See Health</a></div>`):''}
  ${d.supervision?fieldRow('Team view',esc(d.supervision.on?'The main agent can review everyone’s chats for admins. The team sees a note in the chat page.':'Off: chats stay private to each person.')+(d.supervision.recent.length?'<div class="inst-lookups">'+d.supervision.recent.map(e=>'<div>'+esc(String(e.at).slice(0,16).replace('T',' ')+' · '+e.who+' · '+e.action+(e.person?' · '+e.person:'')+(e.agent?' · '+e.agent:''))+'</div>').join('')+'</div>':''),`<div class="inst-val">${toggle(d.supervision.on,'Team view','id="instSup"')}</div>`):''}
  ${d.autoUpdate?fieldRow('Automatic updates',esc(autoUpdateLine(d.autoUpdate,d.maintenance)),`<div class="inst-val">${toggle(d.autoUpdate.on,'Automatic updates','id="instAuto"')}</div>`):''}
  ${d.maintenance?fieldRow('Maintenance window',esc('Updates and restarts that can wait happen here, without waiting for a quiet moment. A reply or schedule that gets interrupted continues by itself afterwards (up to '+d.maintenance.resumeHours+' h later).'),`<div class="inst-val"><span>${esc(d.maintenance.text)}</span><button class="small" data-act="inst-window">Change</button></div>`):''}
  ${fieldRow('Background jobs',esc(d.live.on?'This copy is the live one: it looks after agents, backups and Help.':'This copy is a test copy: it changes nothing on its own (AQEELOS_LIVE=0).'),`<div class="inst-val">${chip(d.live.on?'ok':'',d.live.on?'Live':'Test copy')}</div>`)}`;
 el.prepend(box);
 const sv=box.querySelector('#instSup');if(sv)sv.onchange=async()=>{const on=sv.checked;sv.disabled=true;try{await post(UI,'/ui/install/supervision',{on});Install.d=null;toast(on?'Team view is on':'Team view is off')}catch(e){sv.checked=!on;fail(e)}finally{sv.disabled=false}};
 const oc=box.querySelector('#instOc');if(oc)oc.onchange=async()=>{const on=oc.checked;oc.disabled=true;try{await post(UI,'/ui/install/online-code',{on});Install.d=null;toast(on?'Online Code is on. Used from the next start.':'Online Code is off. Used from the next start.')}catch(e){oc.checked=!on;fail(e)}finally{oc.disabled=false}};
 const au=box.querySelector('#instAuto');if(au)au.onchange=async()=>{const on=au.checked;au.disabled=true;try{await post(UI,'/ui/install/auto-update',{on});Install.d=null;toast(on?'Automatic updates are on':'Automatic updates are off')}catch(e){au.checked=!on;fail(e)}finally{au.disabled=false}}}}

/* ---------- the engine is not reachable with aqeelOS's keys (a fresh engine before its one restart) ---------- */
const ENGINE_SAY={auth:['The engine needs one restart','aqeelOS wrote the engine’s keys into its .env. The engine reads them when it starts, so until then chats, agents and models can’t load. Run this on the server:'],
 down:['aqeelOS can’t reach the engine','Nothing answers at the engine’s address. Start it on the server:']};
function engineCard(e){const [t,d]=ENGINE_SAY[e.state]||[];if(!t)return null;const box=document.createElement('div');box.className='panel card inst-note';box.id='engNote';box.style.marginBottom='16px';
 const cmd=e.state==='auth'?'hermes gateway restart':'hermes gateway run';
 box.innerHTML=`<div class="inst-note-h">${icon('alert',18)}<h2>${esc(t)}</h2></div><p class="sub">${esc(d)}</p><div class="inst-cmd"><code>${esc(cmd)}</code><button class="small" data-act="eng-copy" data-cmd="${esc(cmd)}">${icon('copy',14)}Copy</button></div>
  <p class="sub" style="margin:8px 0 0">Restart the engine’s dashboard too (<span class="mono">hermes dashboard --no-open</span>). Servers set up with the installer start both for you.</p>`;return box}
ACT['eng-copy']=a=>copyText(a.dataset.cmd,'Command copied');
{const base=PAGES.health;PAGES.health=async(p,el,r)=>{const gone=pageTok(el);let err=null;try{await base(p,el,r)}catch(e){if(e?.stale)throw e;err=e}if(gone())return;
 if(S.me?.admin!==false&&!el.querySelector('#engNote')){const d=await Install.load();const c=d?.engine&&engineCard(d.engine);if(c&&!gone())el.prepend(c)}if(err&&!el.querySelector('#engNote'))throw err}}

/* ---------- Health: the last deploy check (scripts/live-test.mjs) and any automatic undo (box-live.sh) ---------- */
{const base=PAGES.health;PAGES.health=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone()||S.me?.admin===false||el.querySelector('#ltBox'))return;
 let d;try{d=await UI('/ui/live-test')}catch{return}const x=(d.runs||[])[0];if(!x||gone())return;
 const when=ago(Math.round(x.at/1000)),bad=!x.ok,u=x.undo;
 const box=document.createElement('div');box.className='panel card'+(bad?' inst-note':'');box.id='ltBox';box.style.marginTop='16px';
 box.innerHTML=`<div class="inst-note-h">${icon(bad?'alert':'check',18)}<h2>Last deploy check</h2></div>
  <p class="sub">${bad?(u?(u.ok?'It failed, so the previous version was put back by itself.':'It failed, and putting the previous version back failed too.'):'It failed.'):'Passed: tool servers, schedules, the engine, a Kirimdev tester message and a test agent reply.'} ${esc(when)}${x.sha?' · version '+esc(String(x.sha).slice(0,8)):''}${u?' · now running '+esc(String(u.to).slice(0,8)):''}.</p>
  ${(x.setup||[]).length?`<p class="sub">The test agent could not take part: ${esc(x.setup[0])}.</p>`:''}
  ${(x.warned||[]).length?`<p class="sub">Reported, not counted (it rests on the model's choices): ${esc(x.warned.join('; '))}.</p>`:''}
  ${bad?`<ul class="inst-steps">${(x.failed||[]).map((f,i)=>`<li ${st(i)}>${icon('alert',14)}<span>${esc(f)}</span></li>`).join('')}</ul>`:''}`;
 el.append(box)}}

/* ---------- Agents: per-agent Linux users missing ---------- */
{const base=PAGES.profiles;PAGES.profiles=async(p,el)=>{const stale=pageTok(el);await base(p,el);if(stale()||S.me?.admin===false||el.querySelector('#auNote'))return;
 const d=await Install.load();if(stale()||!d?.agentUsers||d.agentUsers.ok)return;const u=d.agentUsers;
 const box=document.createElement('div');box.className='panel card inst-note';box.id='auNote';box.style.marginBottom='16px';
 box.innerHTML=`<div class="inst-note-h">${icon('alert',18)}<h2>Agents can’t work on their own yet</h2></div>
  <p class="sub">${u.seen?'The server part that gives each agent its own Linux user stopped.':'The server part that gives each agent its own Linux user isn’t installed.'} Until it runs, agents other than the main agent have no terminal, files, code or Runs itself of their own. The main agent works as usual.</p>
  <p class="sub" style="margin-bottom:6px">Run this once on the server:</p>
  <div class="inst-cmd"><code>${esc(u.fix)}</code><button class="small" data-act="au-copy">${icon('copy',14)}Copy</button></div>`;
 el.prepend(box)}}
ACT['au-copy']=()=>copyText(Install.d?.agentUsers?.fix||'','Command copied');

/* ---------- Models: install the Claude sign-in ---------- */
{const base=PAGES.models;PAGES.models=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone()||S.me?.admin===false||el.querySelector('#clBox'))return;
 const d=await Install.load();if(gone()||!d?.claude)return;const c=d.claude;if(c.cli&&c.plugin&&c.on&&c.job?.state!=='running')return;
 const box=document.createElement('div');box.className='panel card inst-note';box.id='clBox';box.style.marginBottom='16px';el.prepend(box);claudeBox(box,c)}}
function claudeBox(box,c){const j=c.job||{},running=j.state==='running';
 const missing=[!c.cli&&'the Claude app on the server',!c.plugin&&'the engine’s Claude plugin',c.plugin&&!c.on&&'turning the plugin on'].filter(Boolean);
 box.innerHTML=`<div class="inst-note-h">${icon('cpu',18)}<h2>Claude sign-in</h2></div>
  <p class="sub">${j.state==='done'?'Installed. Add a Claude account below to use your Claude plan.':'To use a Claude Pro or Max plan, aqeelOS needs '+esc(missing.join(' and ')||'a moment to finish')+'. One click installs it.'}</p>
  ${j.steps?.length?`<ul class="inst-steps">${j.steps.map((s,i)=>`<li ${st(i)}>${icon(i<j.steps.length-1||j.state==='done'?'check':running?'refresh':'alert',14)}<span>${esc(s)}</span></li>`).join('')}</ul>`:''}
  ${j.state==='failed'?`<p class="inst-check bad">${icon('alert',15)}<span>${esc(j.error)}</span></p>`:''}
  ${j.state==='done'?'':`<button class="primary" data-act="cl-install" ${running?'disabled':''}>${running?'Installing…':j.state==='failed'?'Try again':'Install Claude sign-in'}</button>`}`;
 if(running)setTimeout(async()=>{if(!box.isConnected)return;try{const n=await UI('/ui/install/claude');claudeBox(box,n);if(n.job?.state==='done')toast('Claude sign-in installed')}catch{}},2000)}
ACT['cl-install']=async a=>{a.disabled=true;a.textContent='Installing…';try{await post(UI,'/ui/install/claude',{});const n=await UI('/ui/install/claude');const box=a.closest('#clBox');if(box)claudeBox(box,n)}catch(e){a.disabled=false;a.textContent='Install Claude sign-in';fail(e)}};
