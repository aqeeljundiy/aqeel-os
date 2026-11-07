/* Agent controls an owner needs in the app (7 Nov 2026), admins only:
   - Edit agent › Access › Safety: "Safe tools only" (lock and unlock) and "Trusted (runs as the main user)"
   - Abilities › Skills: which agents get each skill (every agent, or only some), written to skills-policy.json
   - Channels: per Slack workspace, channels kept quiet by the start of their name (ext- for client channels, or none)
   Server routes: /ui/agent-safe, /ui/agent-locks, /ui/agent-trust, /ui/skills-policy, /ui/slack-quiet. */
{const base=agentAccessInto;agentAccessInto=async(box,name)=>{await base(box,name);if(S.me?.admin===false||name==='default'||String(name).includes('--')||!box.isConnected)return;
 const [locks,trust]=await Promise.all([UI('/ui/agent-locks?names='+encodeURIComponent(name)).catch(()=>({})),UI('/ui/agent-trust?names='+encodeURIComponent(name)).catch(()=>null)]);if(!box.isConnected)return;
 const t=trust?.[name]||{},why=locks[name]||'',byAdmin=/^An admin locked/.test(why),n=ident(name).name;
 const el=document.createElement('div');el.className='ag-safety reveal';
 el.innerHTML=`<h3 class="prof-h" style="margin-top:22px">Safety</h3>
  <div class="ag-ctl"><div class="txt"><b>Safe tools only</b><span>${why&&!byAdmin?esc(why):'Terminal, files, code and computer use stay off on every channel.'}</span></div>${why&&!byAdmin?`<span class="tsg-lock" title="${esc(why)}">${icon('lock',14)}</span>`:toggle(!!why,'Safe tools only','data-ctl="safe"')}</div>
  ${trust?`<div class="ag-ctl"><div class="txt"><b>Trusted (runs as the main user)</b><span>${t.may?`Its commands run as the box's main user, so it can reach everything there: keys, sign-ins and other agents' folders. Off: it has its own user and folder.`:'Only agents of admins can be trusted. This one belongs to a member, so it always has its own user.'}</span></div>${toggle(!!t.trusted,'Trusted','data-ctl="trust"'+(t.may||t.trusted?'':' disabled'))}</div>`:''}`;
 box.append(el);
 el.querySelector('[data-ctl="safe"]')?.addEventListener('change',async e=>{const s=e.target,on=s.checked;
  if(!on&&!await confirmBox('Unlock '+n+'?',n+' gets terminal, files, code and computer use back where its owner may have them.','Unlock',false)){s.checked=true;return}
  s.disabled=true;try{const r=await post(UI,'/ui/agent-safe',{agent:name,safe:on});if(r?.still){toast(r.still,'err');s.checked=true}else toast(on?n+' is locked to safe tools':n+' is unlocked')}catch(er){s.checked=!on;fail(er)}finally{s.disabled=false}});
 el.querySelector('[data-ctl="trust"]')?.addEventListener('change',async e=>{const s=e.target,on=s.checked;
  if(on&&!await confirmBox('Trust '+n+'?',n+' will run as the box\'s main user and can reach everything on it. Only for an agent you fully trust.','Trust it',false)){s.checked=false;return}
  s.disabled=true;try{await put(UI,'/ui/agent-trust',{agent:name,trusted:on});toast(on?n+' now runs as the main user. The agents restart once nobody is mid-reply.':n+' now runs as its own user. The agents restart once nobody is mid-reply.')}catch(er){s.checked=!on;fail(er)}finally{s.disabled=false}})}}

/* Skills: "All agents" or "Only N agents" on each skill row (admins); the main agent always keeps every skill */
const SkillPolicy={
 key:s=>(s.category?s.category+'/':'')+s.name,
 ruleFor(pol,s){const r=pol.restricted||{};return r[SkillPolicy.key(s)]||Object.entries(r).find(([k])=>k.split('/').pop()===s.name)?.[1]||null},
 label:r=>r?(r.length<=1?'Main agent only':'Only '+r.length+' agents'):'All agents',
 async open(s,pol,btn){let agents=(Pages._agents||[]).filter(a=>!a.includes('--'));if(!agents.length)try{agents=((await H('/profiles')).profiles||[]).map(x=>x.name).filter(a=>!a.includes('--'))}catch{}
  const rule=SkillPolicy.ruleFor(pol,s);let only=!!rule;
  const {d,close}=stackPop('Who gets '+s.name,`<p style="margin:0 0 12px;color:var(--ink-2);line-height:1.55">Every agent gets each skill the main agent has, unless you pick some here. The others lose it within a few minutes.</p>
   <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:500">Only these agents ${toggle(only,'Only these agents','id="sp-only"')}</label>
   <div class="sk-pick" id="sp-list" ${only?'':'hidden'}>${agents.map(a=>`<label class="pick" style="display:flex;align-items:center;gap:10px"><input type="checkbox" value="${esc(a)}" ${a==='default'||rule?.includes(a)?'checked':''} ${a==='default'?'disabled':''}>${agentAvatar(a,20,{title:false})}<span>${esc(ident(a).name)}${a==='default'?' <small class="hint">always</small>':''}</span></label>`).join('')}</div>`,
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="sp-go">Save</button>`);
  const sw=d.querySelector('#sp-only'),list=d.querySelector('#sp-list');sw.onchange=()=>{only=sw.checked;list.hidden=!only;list.classList.remove('sk-in');if(only){void list.offsetWidth;list.classList.add('sk-in')}};
  d.querySelector('#sp-go').onclick=async e=>{e.stopPropagation();const b=e.currentTarget;b.disabled=true;b.classList.add('is-busy');
   const pick=only?[...list.querySelectorAll('input:checked')].map(i=>i.value):null;
   try{const p2=await put(UI,'/ui/skills-policy',{skill:SkillPolicy.key(s),agents:pick});Pages._skPol=p2;close();toast(only?s.name+': '+SkillPolicy.label(SkillPolicy.ruleFor(p2,s)).toLowerCase():s.name+' goes to every agent');
    if(btn?.isConnected){const r=SkillPolicy.ruleFor(p2,s);btn.classList.toggle('on',!!r);btn.lastChild.textContent=SkillPolicy.label(r)}}
   catch(er){fail(er);b.disabled=false;b.classList.remove('is-busy')}}}};
// both skill lists: one agent's (a row per skill) and All agents (a row per skill with its agents); the All agents view
// draws after this, so rows are watched while the page is open
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone()||S.me?.admin===false||(S.tab.skills||'Installed')!=='Installed')return;
 const pol=await UI('/ui/skills-policy').catch(()=>null);if(!pol||gone())return;Pages._skPol=pol;
 const chip=s=>{const r=SkillPolicy.ruleFor(Pages._skPol||pol,s),b=document.createElement('button');b.type='button';b.className='sk-only'+(r?' on':'');b.title='Which agents get this skill';b.innerHTML=icon('user',13)+'<span>'+esc(SkillPolicy.label(r))+'</span>';
  b.onclick=e=>{e.stopPropagation();e.preventDefault();SkillPolicy.open(s,Pages._skPol||pol,b)};return b};
 const apply=()=>{if(gone()){mo.disconnect();return}
  el.querySelectorAll('[data-act="sk-open"][data-name]').forEach(row=>{const act=row.querySelector('.act');if(!act||act.querySelector('.sk-only'))return;const s=(Pages._skills||[]).find(x=>x.name===row.dataset.name)||{name:row.dataset.name};act.prepend(chip(s))});
  el.querySelectorAll('.all-row').forEach(row=>{const ags=row.querySelector('.aam-ags'),n=row.querySelector('[data-act="all-sk"][data-name]')?.dataset.name;if(!ags||!n||ags.querySelector('.sk-only'))return;
   const s=(Pages._skills||[]).find(x=>x.name===n)||{name:n};ags.append(chip(s))})};
 let q=0;const mo=new MutationObserver(()=>{if(!q)q=requestAnimationFrame(()=>{q=0;apply()})});mo.observe(el,{childList:true,subtree:true});apply()}}

/* Channels: quiet Slack channels, per Slack workspace (admins). Each Slack row says what its workspace keeps quiet, and
   Change sets it for that workspace only ("Slack · Pine & Co: stay quiet in channels starting with…"). */
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone()||S.me?.admin===false||S.chOverride)return;
 const rows=[...el.querySelectorAll('[data-act="ch-more"][data-platform="slack"]')];if(!rows.length)return;
 const q=await UI('/ui/slack-quiet').catch(()=>null);if(!q||gone())return;SlackQuiet.q=q;
 for(const b of rows){const bot=q.bots.find(x=>x.agent===b.dataset.agent),txt=b.closest('.row')?.querySelector('.txt');if(!bot||!txt||txt.querySelector('.sq-line'))continue;txt.append(SlackQuiet.line(bot))}}}
const SlackQuiet={q:null,
 line(bot){const pre=SlackQuiet.q.teams[bot.team]?.prefix||'',s=document.createElement('span');s.className='acct-line sq-line';s.dataset.team=bot.team;
  s.innerHTML=`${pre?`Quiet in channels starting with <b>${esc(pre)}</b>`:'Answers in every channel it is in'} <button type="button" class="link-btn" data-act="sq-edit" data-team="${esc(bot.team)}" data-name="${esc(bot.name)}">${pre?'Change':'Keep some quiet'}</button>`;return s},
 edit(team,name){const cur=SlackQuiet.q?.teams[team]?.prefix||'';const {d,close}=stackPop('Slack · '+(name||'this workspace'),`<label for="sqPre">Stay quiet in channels starting with…</label><input id="sqPre" maxlength="21" autocapitalize="none" spellcheck="false" placeholder="ext-" value="${esc(cur)}">
   <p class="hint" style="margin:8px 0 0">Only in ${esc(name||'this workspace')}. Agents in other Slack workspaces answer as usual. Leave it empty to answer in every channel.</p><p id="sqErr" role="alert" style="margin:8px 0 0;min-height:1.2em;font-size:13px;color:var(--bad)"></p>`,
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="sqGo">Save</button>`);
  const i=d.querySelector('#sqPre'),b=d.querySelector('#sqGo');setTimeout(()=>{i.focus();i.select()},80);let busy=false;
  const go=async()=>{if(busy)return;busy=true;b.disabled=true;b.classList.add('is-busy');
   try{const r=await put(UI,'/ui/slack-quiet',{team,prefix:i.value,name});SlackQuiet.q.teams[team]=r;close();
    document.querySelectorAll('.sq-line[data-team="'+team+'"]').forEach(l=>{const bot=SlackQuiet.q.bots.find(x=>x.team===team);if(bot)l.replaceWith(SlackQuiet.line(bot))});
    toast(r.prefix?'In '+(name||'this workspace')+', channels starting with '+r.prefix+' stay quiet':'In '+(name||'this workspace')+', agents answer in every channel')}
   catch(e){d.querySelector('#sqErr').textContent=e.message||'It could not be saved.'}finally{busy=false;if(b.isConnected){b.disabled=false;b.classList.remove('is-busy')}}};
  b.onclick=e=>{e.stopPropagation();go()};i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();go()}}}};
ACT['sq-edit']=a=>SlackQuiet.edit(a.dataset.team,a.dataset.name);
