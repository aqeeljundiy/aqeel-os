// People: who can sign in to aqeelOS, what they may do, and which agents are shared with them.
// The server enforces every rule (users.mjs); this file only shows the right things.
// A person's picture, or their first letter.
const personAva=(u,s=32)=>`<span class="logo ava person-ava" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.42)}px">${u?.avatar?`<img src="${esc(u.avatar)}" alt="">`:esc((u?.name||'?')[0].toUpperCase())}</span>`;
// An agent's picture, or its first letter on the brand blue.
const agentAva=a=>{const i=ident(a);return `<span class="logo ava agent-ava">${i.avatar?`<img src="${esc(i.avatar)}" alt="">`:esc((i.name||a)[0].toUpperCase())}</span>`};
const LEVEL_LABEL={chat:'Can chat',edit:'Can edit',owner:'Owner'};
const ROLE_LABEL={owner:'Owner',admin:'Admin',member:'Member'};
// Tools a family member's agent never gets: they reach the whole box.
const UNSAFE_TOOLSETS=['terminal','file','code_execution','computer_use'];

async function loadMe(){
 try{S.me=await UI('/ui/me')}catch{S.me={admin:true,role:'owner',name:'',agents:{}}}
 applyRole();
 if(!S.me.admin&&typeof FILE_HOME!=='undefined')FILE_HOME=S.me.home;
}
// Members see Chat and their own Files; admins get the People page.
function applyRole(){
 if(S.me?.admin){const sys=SECTIONS.find(s=>s.id==='system');if(sys&&!sys.pages.some(p=>p.id==='people'))sys.pages.unshift({id:'people',label:'People',icon:'user',desc:'Who can sign in, what they can do, and which agents they can use.'});return}
 const has=k=>(S.me?.caps||[]).includes(k),editsAny=Object.values(S.me?.agents||{}).some(l=>l!=='chat');
 const pg=(sec,id,extra)=>({...SECTIONS.find(s=>s.id===sec).pages.find(p=>p.id===id),...extra});
 const out=[SECTIONS.find(s=>s.id==='chat')];
 if(has('create')||editsAny)out.push({id:'agents',label:'Agents',icon:'user',pages:[pg('agents','profiles',{desc:'Agents you can use and change.'})]});
 if(has('schedules'))out.push({id:'automations',label:'Automations',icon:'zap',pages:[pg('automations','schedules')]});
 out.push({id:'abilities',label:'Abilities',icon:'puzzle',pages:[...(has('skills')?[pg('abilities','skills')]:[]),...(has('mcp')?[pg('abilities','mcp')]:[]),pg('abilities','files',{desc:'Your own folder. Your agents can read what you put here.'})]});
 if(has('usage'))out.push({id:'models',label:'Models',icon:'cpu',pages:[pg('models','accounts',{desc:'How much of each account is used.'})]});
 out.forEach((s,i)=>{if(s.id!=='chat')s.key=String(i+1)});
 SECTIONS.splice(0,SECTIONS.length,...out);
}

/* ---------- invite link: /#invite/<code> ---------- */
async function inviteView(root,code){
 let info=null;try{const r=await fetch('/auth/invite?code='+encodeURIComponent(code));if(r.ok)info=await r.json()}catch{}
 root.innerHTML=`<div class="signin"><form class="card" id="inv"><span class="wordmark"><img class="mark" src="/assets/elkiya-mark.svg" alt="">aqeelOS</span>
  ${info?`<h1>You're invited</h1><p>Pick a password to start using aqeelOS.</p><label for="ivN">Your name</label><input id="ivN" autocomplete="name" value="${esc(info.name||'')}" placeholder="Sarah"><label for="ivU">Username</label><input id="ivU" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(info.username||'')}" placeholder="sarah"><p class="hint" style="margin:4px 0 0">You sign in with this. Letters, numbers, dots or dashes.</p>
  <label for="ivP">Password</label><input id="ivP" type="password" autocomplete="new-password" placeholder="At least 8 characters"><p class="err" id="err" role="alert"></p><button class="primary" type="submit">Join aqeelOS</button>`
  :`<h1>This link doesn't work</h1><p>It has expired or was already used. Ask for a new invite.</p><a class="btn" href="/#signin" style="margin-top:12px">Go to sign in</a>`}</form></div>`;
 const f=$('#inv');if(!info)return;$(info.name?'#ivP':'#ivN').focus();
 f.onsubmit=async e=>{e.preventDefault();const err=$('#err'),b=f.querySelector('button');b.disabled=true;
  try{const r=await fetch('/auth/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:$('#ivN').value.trim(),username:$('#ivU').value.trim(),password:$('#ivP').value})});const d=await r.json().catch(()=>({}));
   if(!r.ok){err.textContent=d.error||'That did not work.';f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');return}
   S.signedIn=true;history.replaceState(null,'','/#/chat');await boot()}finally{b.disabled=false}}}

/* ---------- People page (System › People) ---------- */
PAGES.people=async(p,el)=>{
 setActions(`<button class="primary" data-act="ppl-invite">${icon('plus',16)}Invite someone</button>`);
 const [d,pr]=await Promise.all([UI('/ui/people'),H('/profiles').catch(()=>({profiles:[]}))]);Pages._ppl=d;Pages._agents=(pr.profiles||[]).map(x=>x.name);
 const sharesOf=id=>Object.entries(d.shares||{}).filter(([,m])=>m[id]).map(([a,m])=>[a,m[id]]);
 const person=(u,i)=>{const sh=sharesOf(u.id);const self=u.id===S.me?.id;return `<div class="card person" ${st(i)}><div class="person-head ${self?'self':''}" ${self?'data-act="me-profile" role="button" tabindex="0"':''}>${personAva(u,40)}<div class="txt"><b>${esc(u.name)}</b><span>${u.username?'@'+esc(u.username)+' · ':''}${esc(ROLE_LABEL[u.role])}${self?' · edit your profile':''}${u.last?' · seen '+ago(u.last/1000):''}</span></div></div>
   ${u.role==='owner'||self?'':`<button class="ghost icon-btn more" data-menu="person" data-id="${esc(u.id)}" aria-label="More">${icon('more',18)}</button>`}
   ${u.role==='member'?`<div class="pshares"><span class="th">Agents</span>${sh.length?sh.map(([a,l])=>`<div class="pshare">${agentAva(a)}<b>${esc(ident(a).name)}</b><select style="width:auto" data-share="${esc(a)}" data-user="${esc(u.id)}">${Object.entries(LEVEL_LABEL).map(([k,v])=>`<option value="${k}" ${k===l?'selected':''}>${v}</option>`).join('')}<option value="">Remove</option></select></div>`).join(''):'<p class="hint" style="margin:4px 0">No agents shared yet.</p>'}
    <button class="ghost" data-act="ppl-share" data-id="${esc(u.id)}" style="margin-top:6px">${icon('plus',15)}Share an agent</button></div>
   <div class="pcaps"><span class="th">Allowed to</span>${Object.entries(d.caps||{}).map(([k,l])=>`<label class="capt ${k==='unsafe'?'risky':''}"><input type="checkbox" data-cap="${k}" data-user="${esc(u.id)}" ${(u.caps||[]).includes(k)?'checked':''} ${k==='unsafe'&&S.me?.role!=='owner'?'disabled':''}><span>${esc(l)}</span></label>`).join('')}</div>`:`<p class="hint" style="margin:10px 0 0">${u.role==='owner'?'Everything, including people and keys.':'Everything except changing the owner.'}</p>`}</div>`};
 const inv=(d.invites||[]).map((x,i)=>`<div class="row" ${st(i)} style="padding:12px 12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="txt"><b>${esc(x.name||'Anyone with the link')} · ${esc(ROLE_LABEL[x.role])}</b><span>Expires ${new Date(x.expires).toLocaleDateString()}${Object.keys(x.agents||{}).length?' · '+Object.keys(x.agents).map(a=>esc(ident(a).name)).join(', '):''}</span></div><div class="act"><button data-act="ppl-copy" data-code="${esc(x.code)}">${icon('copy',15)}Copy link</button><button class="ghost" data-act="ppl-uninvite" data-code="${esc(x.code)}" aria-label="Cancel invite">${icon('x',16)}</button></div></div>`).join('');
 el.innerHTML=`<div class="people-grid">${[d.owner,...d.users].map(person).join('')}</div>
  ${inv?`<div class="panel card" style="margin-top:16px"><h2>Waiting to join</h2><p class="sub">Links work once and expire after 7 days.</p>${inv}</div>`:''}
  <div class="panel card" style="margin-top:16px"><h2>Email sending</h2><p class="sub">Used for sign-in codes and invites.</p><div id="mailBox">${skeleton(1)}</div></div>
  <div class="panel card" style="margin-top:16px"><h2>How sharing works</h2><p class="sub" style="margin-bottom:0">Two layers. <b>Each person has a role</b> (Roles above): what they may do, which models they get, a daily limit and how many agents they may own. <b>Each agent is shared per person</b>: Can chat uses it, Can edit also changes it within their role, Owner can also delete or give it away. Agent settings, keys and channels stay with admins. Everyone's chats are private, also from you.</p></div>`;
 el.querySelectorAll('[data-cap]').forEach(x=>x.onchange=async()=>{const id=x.dataset.user;
  if(x.dataset.cap==='unsafe'&&x.checked&&!await confirmBox('Give terminal and file tools?','Agents with these tools can read everything on the box, including your keys and other people\'s files. Only for people you trust like an admin.','Allow')){x.checked=false;return}
  const caps=[...el.querySelectorAll('[data-cap][data-user="'+id+'"]')].filter(i=>i.checked).map(i=>i.dataset.cap);try{await UI('/ui/people/'+id,{method:'PATCH',body:{caps}});toast('Saved')}catch(e){fail(e)}});
 el.querySelectorAll('[data-share]').forEach(s=>s.onchange=async()=>{try{await put(UI,'/ui/people/share',{agent:s.dataset.share,user:s.dataset.user,level:s.value});toast(s.value?'Updated':'Agent removed');if(!s.value)reload()}catch(e){fail(e)}});
};
const agentPicker=(id,taken=[])=>`<div id="${id}">${(Pages._agents||[]).filter(a=>!taken.includes(a)).map(a=>`<label class="pick"><input type="checkbox" value="${esc(a)}">${agentAva(a)}<span>${esc(ident(a).name)}</span><select style="width:auto">${Object.entries(LEVEL_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`).join('')||'<p class="hint">Every agent is already shared.</p>'}</div>`;
const pickedAgents=id=>Object.fromEntries([...$$('#'+id+' .pick')].filter(l=>l.querySelector('input').checked).map(l=>[l.querySelector('input').value,l.querySelector('select').value]));
// A new agent for a family member: own name, Claude plan, no terminal / files / computer use.
async function makeSafeAgent(name){
 const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'family';
 let id=slug,n=2;while((Pages._agents||[]).includes(id))id=slug+'-'+n++;
 await post(H,'/profiles',{name:id,clone_from_default:false,no_skills:false});
 await post(UI,'/ui/accounts/setup-agent',{name:id}).catch(()=>{});
 for(const t of UNSAFE_TOOLSETS)await put(H,'/tools/toolsets/'+t+'?profile='+encodeURIComponent(id),{enabled:false}).catch(()=>{});
 await put(UI,'/ui/identities/'+encodeURIComponent(id),{name,title:''}).catch(()=>{});
 await loadIdentities();return id}
ACT['ppl-invite']=()=>{const d=drawer('Invite someone',`<label>Their name</label><input id="ivName" placeholder="Sarah"><label>Their email (optional)</label><input id="ivMail" type="email" placeholder="sarah@example.com"><p class="hint" style="margin:4px 0 0">We email them the invite link. You also get it to copy.</p>
  <label>Role</label><select id="ivRole">${Object.entries(Pages._ppl?.roles||{}).map(([k,ro])=>`<option value="${esc(k)}">${esc(ro.name)}: ${esc(roleSummary(ro))}</option>`).join('')}${S.me?.role==='owner'?'<option value="admin">Admin: can do everything</option>':''}</select>
  <div id="ivAgents"><label>Agents they can use</label>${agentPicker('ivPick')}
  <label class="pick" style="margin-top:10px"><input type="checkbox" id="ivNew" checked><span><b>Also make them their own agent</b><br><small class="hint">Uses your Claude plan. No terminal, files or computer use.</small></span></label>
  <input id="ivNewName" placeholder="Name for their agent, e.g. Sarah's assistant" style="margin-top:6px"></div>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="ivGo">Create invite link</button>`);
 const sync=()=>{$('#ivAgents').hidden=$('#ivRole').value==='admin';$('#ivNewName').hidden=!$('#ivNew').checked};$('#ivRole').onchange=sync;$('#ivNew').onchange=sync;
 $('#ivName').oninput=e=>{const v=e.target.value.trim();$('#ivNewName').placeholder=v?v+"'s assistant":"Name for their agent"};
 d.querySelector('#ivGo').onclick=async()=>{const name=$('#ivName').value.trim(),pick=$('#ivRole').value,role=pick==='admin'?'admin':'member',roleId=pick==='admin'?null:pick,caps=[];const b=d.querySelector('#ivGo');b.disabled=true;
  try{const agents=role==='admin'?{}:pickedAgents('ivPick');
   if(role!=='admin'&&$('#ivNew').checked){const an=$('#ivNewName').value.trim()||(name?name+"'s assistant":'Family assistant');b.textContent='Making their agent…';const id=await makeSafeAgent(an);agents[id]='owner'}
   const inv=await post(UI,'/ui/people/invite',{name,role,roleId,caps,agents});const to=$('#ivMail').value.trim();closeLayers();
   if(to){try{await post(UI,'/ui/people/invite/'+inv.code+'/email',{to,link:location.origin+'/#invite/'+inv.code});toast('Invite emailed to '+to+'. The link is copied too.')}catch(e){toast('Email failed ('+(e.message||e)+'). The link is copied instead.','err')}}
   await copyInvite(inv.code);reload()}catch(e){fail(e)}finally{b.disabled=false}}};
async function copyInvite(code){const link=location.origin+'/#invite/'+code;try{await navigator.clipboard.writeText(link);toast('Invite link copied. Send it to them.')}catch{await promptBox('Invite link','Copy this link and send it',link,'Done')}}
ACT['ppl-copy']=a=>copyInvite(a.dataset.code);
ACT['ppl-uninvite']=async a=>{try{await del(UI,'/ui/people/invite/'+a.dataset.code);toast('Invite cancelled');reload()}catch(e){fail(e)}};
ACT['ppl-share']=a=>{const id=a.dataset.id;const taken=Object.entries(Pages._ppl?.shares||{}).filter(([,m])=>m[id]).map(([x])=>x);
 const d=drawer('Share an agent',agentPicker('shPick',taken),`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="shGo">Share</button>`);
 d.querySelector('#shGo').onclick=async()=>{try{for(const [agent,level] of Object.entries(pickedAgents('shPick')))await put(UI,'/ui/people/share',{agent,user:id,level});closeLayers();toast('Shared');reload()}catch(e){fail(e)}}};
Pages.personMenu=el=>{const u=(Pages._ppl?.users||[]).find(x=>x.id===el.dataset.id);if(!u)return;
 menu(el,[...(S.me?.role==='owner'?[{label:u.role==='admin'?'Make member':'Make admin',icon:'user',run:async()=>{try{await UI('/ui/people/'+u.id,{method:'PATCH',body:{role:u.role==='admin'?'member':'admin'}});reload()}catch(e){fail(e)}}},'-']:[]),
  {label:'Remove '+u.name,icon:'trash',danger:true,run:async()=>{if(!await confirmBox('Remove '+u.name+'?','They can no longer sign in. Their chats stay on the box.','Remove'))return;try{await del(UI,'/ui/people/'+u.id);toast(u.name+' removed');reload()}catch(e){fail(e)}}}])};
ACT['me-profile']=()=>{const me=S.me||{};
 const d=drawer('Your profile',`<div class="prof-pic">${personAva(me,72)}<div><button id="pfPic">${icon('upload',15)}Change picture</button>${me.avatar?`<button class="ghost" id="pfPicDel">Remove</button>`:''}<input type="file" id="pfFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden><p class="hint" style="margin:6px 0 0">PNG, JPG, WebP or GIF, under 2 MB.</p></div></div>
  <label>Name</label><input id="pfName" value="${esc(me.name||'')}" autocomplete="name"><label>Username</label><input id="pfUser" value="${esc(me.username||'')}" autocomplete="username" autocapitalize="none" spellcheck="false"><p class="hint" style="margin:4px 0 0">You sign in with your username.</p>
  <h3 class="prof-h">Email</h3><label>Email address</label><div class="row-in"><input id="pfMail" type="email" value="${esc(me.email||'')}" placeholder="you@example.com" autocomplete="email"><span class="chip ${me.email?(me.emailVerified?'ok':'warn'):''}" id="pfMailState">${me.email?(me.emailVerified?'Confirmed':'Not confirmed'):'None'}</span></div>
  <div id="pfVerify" ${me.email&&!me.emailVerified?'':'hidden'}><label>Code from the email</label><div class="row-in"><input id="pfCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"><button id="pfCodeGo">Confirm</button><button class="ghost" id="pfResend">Send again</button></div><p class="hint" style="margin:4px 0 0">Check spam too. Codes work for 10 minutes.</p></div>
  <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px">Ask for an email code when I sign in ${toggle(!!me.twoStep,'Two-step sign-in','id="pf2s" '+(me.emailVerified?'':'disabled'))}</label>
  <h3 class="prof-h">Password</h3><label>Current password</label><input id="pwC" type="password" autocomplete="current-password"><label>New password</label><input id="pwN" type="password" autocomplete="new-password" placeholder="At least 8 characters">
  <p class="hint" style="margin:6px 0 0">Leave both empty to keep your password.</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="pfGo">Save</button>`);
 const pick=d.querySelector('#pfFile');d.querySelector('#pfPic').onclick=()=>pick.click();
 pick.onchange=()=>{const f=pick.files[0];if(!f)return;if(f.size>2e6)return toast('Pictures must be under 2 MB.','err');const rd=new FileReader();rd.onload=async()=>{try{await put(UI,'/ui/me/avatar',{data:rd.result});await loadMe();toast('Picture updated');closeLayers();ACT['me-profile']();paintSide()}catch(e){fail(e)}};rd.readAsDataURL(f)};
 d.querySelector('#pfPicDel')?.addEventListener('click',async()=>{try{await del(UI,'/ui/me/avatar');await loadMe();toast('Picture removed');closeLayers();ACT['me-profile']()}catch(e){fail(e)}});
 let vkey=null;const showVerify=on=>{d.querySelector('#pfVerify').hidden=!on};
 d.querySelector('#pfCodeGo').onclick=async()=>{if(!vkey){const r=await post(UI,'/ui/me/email/resend').catch(e=>{fail(e)});if(!r)return;vkey=r.key;return toast('New code sent. Enter it.')}
  try{await post(UI,'/ui/me/email/verify',{key:vkey,code:$('#pfCode').value});await loadMe();toast('Email confirmed');closeLayers();ACT['me-profile']()}catch(e){fail(e)}};
 d.querySelector('#pfResend').onclick=async()=>{try{vkey=(await post(UI,'/ui/me/email/resend')).key;toast('Code sent. Check spam too.')}catch(e){fail(e)}};
 d.querySelector('#pf2s').onchange=async e=>{try{await put(UI,'/ui/me/two-step',{on:e.target.checked});await loadMe();toast(e.target.checked?'Two-step sign-in on':'Two-step sign-in off')}catch(er){e.target.checked=!e.target.checked;fail(er)}};
 d.querySelector('#pfGo').onclick=async()=>{const b=d.querySelector('#pfGo');b.disabled=true;try{
   const mailNow=$('#pfMail').value.trim().toLowerCase();if(mailNow!==(me.email||'')){const r=await put(UI,'/ui/me/email',{email:mailNow}).catch(e=>{fail(e);return null});if(r?.key){vkey=r.key;await loadMe();showVerify(true);d.querySelector('#pfMailState').textContent='Not confirmed';d.querySelector('#pfMailState').className='chip warn';toast('We sent a code to '+mailNow+'. Enter it below.');b.disabled=false;return}}
   const name=$('#pfName').value.trim(),username=$('#pfUser').value.trim().toLowerCase();if(name!==me.name||username!==(me.username||''))await put(UI,'/ui/me',{name,username});
   if($('#pwC').value||$('#pwN').value)await put(UI,'/ui/me/password',{current:$('#pwC').value,next:$('#pwN').value});
   await loadMe();closeLayers();toast('Profile saved');if(route().page?.id==='people')reload()}catch(e){fail(e)}finally{b.disabled=false}}};
ACT['me-password']=()=>ACT['me-profile']();

/* ---------- members on the Agents page: only what their share level and permissions allow ---------- */
{const full=Pages.profileMenu;
 Pages.profileMenu=el=>{if(S.me?.admin!==false)return full(el);
  const lvl=S.me.agents?.[el.dataset.name]||'chat',edit=lvl!=='chat',has=k=>(S.me.caps||[]).includes(k);
  const ok=new Set(['Manage here',...(edit?['Edit identity','Rename','Edit description','Write description for me','Edit SOUL']:[]),...(edit&&has('models')?['Change model']:[]),...(lvl==='owner'?['Delete']:[])]);
  const real=window.menu;window.menu=(a,items,...rest)=>{window.menu=real;const list=items.filter(i=>i&&(i==='-'||i.header||ok.has(i.label)));return real(a,list.filter((i,n)=>i!=='-'||(n>0&&list[n-1]!=='-'&&n<list.length-1)),...rest)};
  try{full(el)}catch(e){window.menu=real;throw e}}}

ACT['tool-off']=a=>{Chat.tools.splice(+a.dataset.i,1);Chat.paintTools()};

/* ---------- Agents page with owners: who owns each agent, who it is shared with, private ones locked ---------- */
PAGES.profiles=async(p,el)=>{
 const [pr,act]=await Promise.all([H('/profiles'),H('/profiles/active').catch(()=>({}))]);Pages._profiles=pr.profiles||[];
 const own=await UI('/ui/agents?names='+encodeURIComponent(Pages._profiles.map(x=>x.name).join(','))).catch(()=>({}));Pages._own=own;
 setActions(S.me?.admin===false&&!(S.me.caps||[]).includes('create')?'':`<button class="primary" data-act="prof-new">${icon('plus',16)}New agent</button>`);
 const list=Pages._profiles.filter(x=>own[x.name]||S.me?.admin!==false);
 el.innerHTML=`<div class="grid-cards">${list.map((x,i)=>{const id=ident(x.name),o=own[x.name]||{},locked=o.access===null&&o.private;
  return `<div class="card tile agent-card ${locked?'locked':''}" ${st(i)} ${locked?`data-act="agent-locked" data-owner="${esc(o.owner?.name||'')}"`:`data-act="ident-open"`} data-name="${esc(x.name)}">
  <div class="tile-top"><span class="logo ava">${id.avatar&&!locked?`<img src="${esc(id.avatar)}" alt="">`:esc(id.name[0].toUpperCase())}</span><div style="min-width:0"><h3>${esc(id.name)}</h3><span style="font-size:12.5px;color:var(--muted)">${locked?'Private':esc(id.title||'Agent')+' · '+esc(modelLabel(x.model))+' · '+plural(x.skill_count||0,'skill')}</span></div>${locked?`<span class="chip">${icon('lock',12)}Private</span>`:''}</div>
  ${locked?`<p class="hint">Only ${esc(o.owner?.name||'its owner')} and the people they share it with can open it.</p>`:`<p>${esc(x.description||'No description yet.')}</p>`}
  <div class="agent-people">${o.owner?`<span class="aowner" title="Owner">${personAva(o.owner,22)}<span>${esc(o.owner.id===S.me?.id?'You':o.owner.name)}</span><small>owner</small></span>`:''}${(o.shared||[]).length?`<span class="ashared">${o.shared.slice(0,5).map(s=>`<span title="${esc(s.name)} · ${esc(LEVEL_LABEL[s.level]||s.level)}">${personAva(s,22)}</span>`).join('')}${o.shared.length>5?`<small>+${o.shared.length-5}</small>`:''}</span>`:''}</div>
  <div class="agent-tags">${x.is_default?'<span class="chip blue">Default</span>':''}${locked?'':chipState(x.gateway_running,'Gateway on','Gateway off')}</div><div class="tile-foot"><span>${locked?'':(S.profile||'default')===x.name?'<span class="chip ok"><i class="dot"></i>In use</span>':`<button class="primary small" data-act="agent-use" data-name="${esc(x.name)}">${icon('chat',14)}Use this agent</button>`}${act.active===x.name?'<span class="chip" title="The agent the command line uses">CLI default</span>':''}</span>${locked?'':`<button class="ghost icon" data-menu="profilecard" data-name="${esc(x.name)}" aria-label="More">${icon('more',18)}</button>`}</div></div>`}).join('')}</div>`;
};
ACT['agent-locked']=a=>toast('This agent is private to '+(a.dataset.owner||'its owner')+'. Ask them to share it with you.');
// Sharing and owner, from an agent's ⋯ menu (its owner only)
ACT['agent-share']=async name=>{let people=[];try{people=await UI('/ui/people/list')}catch(e){return fail(e)}
 const o=(await UI('/ui/agents?names='+encodeURIComponent(name)).catch(()=>({})))[name]||{};const others=people.filter(x=>x.id!==o.owner?.id);
 const row=s=>`<div class="pshare">${personAva(s,28)}<b>${esc(s.name)}</b><select style="width:auto" data-ash="${esc(s.id)}">${Object.entries(LEVEL_LABEL).map(([k,v])=>`<option value="${k}" ${k===s.level?'selected':''}>${v}</option>`).join('')}<option value="">Remove</option></select></div>`;
 const notYet=others.filter(x=>!(o.shared||[]).some(s=>s.id===x.id));
 const d=drawer('Sharing · '+ident(name).name,`<label>Owner</label><div class="pshare">${personAva(o.owner,28)}<b>${esc(o.owner?.name||'')}</b>${others.length?`<select style="width:auto" id="ashOwner"><option value="">Keep owner</option>${others.map(x=>`<option value="${esc(x.id)}">Give to ${esc(x.name)}</option>`).join('')}</select>`:''}</div>
  <label>Shared with</label>${(o.shared||[]).map(row).join('')||'<p class="hint">Nobody yet.</p>'}
  ${notYet.length?`<label>Add someone</label><div class="pshare"><select id="ashWho">${notYet.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} (@${esc(x.username)})</option>`).join('')}</select><select style="width:auto" id="ashLvl">${Object.entries(LEVEL_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button id="ashAdd">Add</button></div>`:''}
  <p class="hint" style="margin-top:16px">Giving the agent away makes the new person its owner; you keep Can edit.</p>`,`<button class="primary" data-act="close">Done</button>`);
 const call=async(path,body,msg)=>{try{await UI('/ui/agents/'+encodeURIComponent(name)+path,{method:'PUT',body});toast(msg);closeLayers();ACT['agent-share'](name);if(route().page?.id==='profiles')reload()}catch(e){fail(e)}};
 d.querySelectorAll('[data-ash]').forEach(s=>s.onchange=()=>call('/share',{user:s.dataset.ash,level:s.value},s.value?'Updated':'Removed'));
 d.querySelector('#ashAdd')?.addEventListener('click',()=>call('/share',{user:$('#ashWho').value,level:$('#ashLvl').value},'Shared'));
 d.querySelector('#ashOwner')?.addEventListener('change',async e=>{if(!e.target.value)return;const who=others.find(x=>x.id===e.target.value);if(!await confirmBox('Give '+ident(name).name+' to '+who.name+'?','They become its owner. You keep Can edit.','Give it away',false)){e.target.value='';return}call('/owner',{user:who.id},'Owner changed')})};
{const withShare=Pages.profileMenu;Pages.profileMenu=el=>{const n=el.dataset.name,o=Pages._own?.[n];
 const real=window.menu;window.menu=(a,items,...rest)=>{window.menu=real;const extra=o?.access==='owner'?[{label:'Sharing and owner…',icon:'user',run:()=>ACT['agent-share'](n)},'-']:[];return real(a,[...extra,...items],...rest)};
 try{withShare(el)}catch(e){window.menu=real;throw e}}}

async function mailPanel(){const box=$('#mailBox');if(!box)return;let m;try{m=await UI('/ui/mail')}catch(e){box.innerHTML='<p class="hint">Only admins can change this.</p>';return}
 box.innerHTML=`<label>Send email</label><select id="mlMode"><option value="direct" ${m.mode==='direct'?'selected':''}>Straight from the server (free, often in spam)</option><option value="smtp" ${m.mode==='smtp'?'selected':''}>Through a mail account (reliable)</option></select>
  <label>From</label><input id="mlFrom" value="${esc(m.from)}">
  <div id="mlSmtp" ${m.mode==='smtp'?'':'hidden'}><div class="sched-row"><div><label>Server</label><input id="mlHost" value="${esc(m.host)}" placeholder="smtp.gmail.com"></div><div><label>Port</label><input id="mlPort" value="${esc(String(m.port||''))}" placeholder="587"></div></div>
   <div class="sched-row"><div><label>Username</label><input id="mlUser" value="${esc(m.user)}" autocomplete="off"></div><div><label>Password</label><input id="mlPass" type="password" placeholder="${m.hasPass?'Saved. Type to replace':'App password'}" autocomplete="new-password"></div></div>
   <p class="hint">For Gmail: turn on 2-step verification, make an app password, use smtp.gmail.com port 587.</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="primary" id="mlSave">Save</button><input id="mlTo" type="email" placeholder="Send a test to…" style="flex:1;min-width:180px"><button id="mlTest">Send test</button></div>`;
 $('#mlMode').onchange=e=>$('#mlSmtp').hidden=e.target.value!=='smtp';
 $('#mlSave').onclick=async()=>{try{await put(UI,'/ui/mail',{mode:$('#mlMode').value,from:$('#mlFrom').value,host:$('#mlHost').value,port:$('#mlPort').value,user:$('#mlUser').value,pass:$('#mlPass').value||undefined});toast('Email settings saved')}catch(e){fail(e)}};
 $('#mlTest').onclick=async()=>{const b=$('#mlTest');b.disabled=true;try{await post(UI,'/ui/mail/test',{to:$('#mlTo').value});toast('Test sent. Check the inbox and spam.')}catch(e){fail(e)}finally{b.disabled=false}}}
{const people=PAGES.people;PAGES.people=async(p,el)=>{await people(p,el);mailPanel()}}

/* ---------- per person: which models, and a daily limit ---------- */
const LIMITS=[[0,'No limit'],[50000,'50k tokens a day'],[200000,'200k tokens a day'],[1000000,'1M tokens a day'],[5000000,'5M tokens a day']];
const modelSummary=u=>!u.models?'Every model you have on':u.models.length===1?modelLabel(u.models[0].split('|').pop()):u.models.length+' models';
ACT['ppl-models']=async a=>{const u=(Pages._ppl?.users||[]).find(x=>x.id===a.dataset.id);if(!u)return;if(!Chat.models)await Chat.loadModels().catch(()=>{});
 const ms=Chat.models||[];const on=k=>!u.models||u.models.includes(k);
 const d=drawer('Models for '+u.name,`<label class="pick"><input type="checkbox" id="pmAll" ${!u.models?'checked':''}><span><b>Every model you have on</b><br><small class="hint">New models are included automatically.</small></span></label>
  <div id="pmList" ${!u.models?'hidden':''}>${[...new Set(ms.map(m=>m.providerName))].map(pv=>`<label>${esc(pv)}</label>${ms.filter(m=>m.providerName===pv).map(m=>`<label class="pick"><input type="checkbox" value="${esc(m.provider+'|'+m.id)}" ${on(m.provider+'|'+m.id)?'checked':''}><span>${esc(m.label)}</span></label>`).join('')}`).join('')}</div>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="pmGo">Save</button>`);
 d.querySelector('#pmAll').onchange=e=>d.querySelector('#pmList').hidden=e.target.checked;
 d.querySelector('#pmGo').onclick=async()=>{const all=d.querySelector('#pmAll').checked;const list=[...d.querySelectorAll('#pmList input:checked')].map(i=>i.value);if(!all&&!list.length)return toast('Pick at least one model','err');
  try{await UI('/ui/people/'+u.id,{method:'PATCH',body:{models:all?null:list}});closeLayers();toast('Saved');reload()}catch(e){fail(e)}}};
{const people=PAGES.people;PAGES.people=async(p,el)=>{await people(p,el);
 el.querySelectorAll('.person').forEach(card=>{const id=card.querySelector('[data-cap]')?.dataset.user;const u=(Pages._ppl?.users||[]).find(x=>x.id===id);if(!u||u.role!=='member')return;
  const box=document.createElement('div');box.className='pcaps';box.innerHTML=`<span class="th">Models and limit</span>
   <div class="pshare"><b>${esc(modelSummary(u))}</b><button class="ghost" data-act="ppl-models" data-id="${esc(u.id)}">Choose</button></div>
   <div class="pshare"><b>Daily limit</b><select style="width:auto" data-limit="${esc(u.id)}">${LIMITS.map(([v,l])=>`<option value="${v}" ${(u.limit?.tokens||0)===v?'selected':''}>${l}</option>`).join('')}</select></div>`;
  card.append(box);enhanceSelect(box.querySelector('select'))});
 el.querySelectorAll('[data-limit]').forEach(s=>s.onchange=async()=>{try{await UI('/ui/people/'+s.dataset.limit,{method:'PATCH',body:{limit:+s.value?{tokens:+s.value}:null}});toast('Saved')}catch(e){fail(e)}})}}

/* ---------- System › Usage: by person, by agent, by model ---------- */
{const base=PAGES.usage;PAGES.usage=async(p,el)=>{await base(p,el);
 const days=+String(S.tab.usage||'7 days').split(' ')[0]||7;let d;try{d=await UI('/ui/usage?days='+days)}catch{return}
 const tok=o=>num((o.input||0)+(o.output||0));
 const table=(title,rows,label)=>rows.length?`<div class="panel card" style="margin-top:16px"><h2>${title}</h2><div class="utable"><div class="uh"><span>${label}</span><span>Chats</span><span>Messages</span><span>Tokens</span><span>Cache</span><span>Est. cost</span></div>
  ${rows.map(([k,o,head])=>`<div class="ur">${head}<span>${num(o.chats)}</span><span>${num(o.messages)}</span><span>${tok(o)}</span><span>${num(o.cache)}</span><span>$${(o.cost||0).toFixed(2)}</span></div>`).join('')}</div></div>`:'';
 const ppl=Object.entries(d.byPerson||{}).filter(([,o])=>o).sort((a,b)=>(b[1].input+b[1].output)-(a[1].input+a[1].output)).map(([id,o])=>{const x=d.people?.[id]||{name:id};return [id,o,`<span class="uname">${personAva({name:x.name,avatar:x.avatar},24)}${esc(id===S.me?.id?'You':x.name)}${x.limit?`<small>limit ${num(x.limit.tokens)}/day</small>`:''}</span>`]});
 const ags=Object.entries(d.byAgent||{}).sort((a,b)=>(b[1].input+b[1].output)-(a[1].input+a[1].output)).map(([a,o])=>[a,o,`<span class="uname">${agentAva(a)}${esc(ident(a).name)}</span>`]);
 const mds=Object.entries(d.byModel||{}).sort((a,b)=>(b[1].input+b[1].output)-(a[1].input+a[1].output)).map(([m,o])=>[m,o,`<span class="uname">${esc(modelLabel(m))}</span>`]);
 const box=document.createElement('div');box.innerHTML=(d.today?`<div class="panel card" style="margin-top:16px"><h2>You today</h2><p class="sub" style="margin:0">${num(d.today.tokens)} tokens in ${num(d.today.messages)} messages${d.people?.[S.me?.id]?.limit?` of your ${num(d.people[S.me.id].limit.tokens)} a day`:''}.</p></div>`:'')
  +table('By person',ppl,'Person')+table('By agent',ags,'Agent');el.append(box)}}

/* ---------- MCP: run the same server more than once (e.g. three AdsPower setups), each with its own name and settings ---------- */
ACT['mcp-dup']=a=>{const m=(Pages._mcp||[]).find(x=>x.name===a.dataset.name);if(!m)return;
 let n=2;const base=m.name.replace(/-\d+$/,'');while((Pages._mcp||[]).some(x=>x.name===base+'-'+n))n++;
 const env=Object.entries(m.env||{}).map(([k,v])=>k+'='+(v&&!/^\*+|•/.test(String(v))?v:'')).join('\n');
 const d=drawer('Duplicate '+m.name,`<p class="hint" style="margin:0 0 8px">A second copy of this tool under its own name. Give it different settings (for example another profile or key) so each copy does its own job.</p>
  <label>Name</label><input id="mdN" value="${esc(base+'-'+n)}">
  ${m.url?`<label>Server URL</label><input id="mdU" value="${esc(m.url)}">`:`<label>Command</label><input id="mdC" value="${esc(m.command||'')}"><label>Arguments</label><input id="mdA" value="${esc((m.args||[]).join(' '))}">`}
  <label>Settings (one KEY=value per line)</label><textarea id="mdE" rows="5" placeholder="ADSPOWER_PROFILE=Shop 2">${esc(env)}</textarea>
  <p class="hint" style="margin:4px 0 0">Secret values are never copied. Type them again if this copy needs them.</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="mdGo">Add copy</button>`);
 d.querySelector('#mdGo').onclick=async()=>{const name=$('#mdN').value.trim();if(!/^[\w.-]{1,64}$/.test(name))return toast('Use letters, numbers, dots or dashes for the name','err');
  const body={name,env:Object.fromEntries($('#mdE').value.split('\n').map(l=>l.split('=')).filter(x=>x[0]&&x.length>1).map(([k,...v])=>[k.trim(),v.join('=').trim()]))};
  if(m.url)body.url=$('#mdU').value.trim();else{body.command=$('#mdC').value.trim();body.args=$('#mdA').value.trim().split(/\s+/).filter(Boolean)}
  try{await post(H,'/mcp/servers',body);closeLayers();toast(name+' added');reload()}catch(e){fail(e)}}};

/* ---------- Memory: MEMORY.md and USER.md are plain files the agent reads; you can edit them ---------- */
const memHome=()=>'/home/claude/.hermes'+((S.profile||'default')==='default'?'':'/profiles/'+S.profile);
ACT['mem-edit']=async a=>{const f=a.dataset.f,path=memHome()+'/memories/'+f;let cur='';try{cur=(await readText(path)).text||''}catch{}
 const d=drawer('Edit '+f,`<p class="hint" style="margin:0 0 8px">${f==='USER.md'?'What the agent knows about you: name, preferences, how you like answers.':'Notes the agent keeps about its work.'} It reads this at the start of every chat. Keep it short; entries are separated by a line with §.</p>
  <textarea id="memT" rows="18" style="font-family:var(--mono);font-size:12.5px">${esc(cur)}</textarea>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="memGo">Save</button>`);
 d.querySelector('#memGo').onclick=async()=>{const fd=new FormData();fd.append('path',path);fd.append('overwrite','true');fd.append('file',new Blob([$('#memT').value],{type:'text/markdown'}),f);
  try{await H('/files/upload-stream',{method:'POST',body:fd});closeLayers();toast(f+' saved');reload()}catch(e){fail(e)}}};

ACT['agent-use']=a=>{switchAgent(a.dataset.name);go('/chat')};

/* ---------- plain names and "what it does" (written once by Haiku, see explain.mjs) ---------- */
const EXPLAIN={};
async function explainFor(kind,items,repaint,tries=0){const want=items.filter(it=>!EXPLAIN[kind+':'+it.id]);
 if(want.length){try{const r=await post(UI,'/ui/explain',{kind,items:want});Object.entries(r.items||{}).forEach(([id,v])=>EXPLAIN[kind+':'+id]=v);
  if(r.pending&&tries<4)setTimeout(()=>explainFor(kind,items,repaint,tries+1),8000+tries*4000)}catch{}}
 repaint?.()}
const ex=(kind,id)=>EXPLAIN[kind+':'+id];
// rows of a list: plain title on top, the real name small, and the one-line summary
function paintExplained(el,kind,sel,idOf){el.querySelectorAll(sel).forEach(r=>{const v=ex(kind,idOf(r));if(!v||r.dataset.ex)return;r.dataset.ex='1';
 const b=r.querySelector('.txt b'),s=r.querySelector('.txt span');if(!b)return;const real=b.textContent;b.innerHTML=`${esc(v.title)} <small class="realname">${esc(real)}</small>`;
 if(s&&v.summary){s.dataset.orig=s.textContent;s.textContent=v.summary;s.title=s.dataset.orig}})}

// Skills
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{await base(p,el);const rows=[...el.querySelectorAll('[data-act="sk-open"][data-name]')];if(!rows.length)return;
 rows.forEach(r=>{const ic=r.querySelector('.ic');if(ic)ic.innerHTML=icon('wand',17)});
 const items=rows.map(r=>({id:r.dataset.name,name:r.dataset.name,desc:r.querySelector('.txt span')?.textContent||''}));
 explainFor('skill',items,()=>paintExplained(el,'skill','[data-act="sk-open"][data-name]',r=>r.dataset.name))}}

// MCP servers
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{await base(p,el);const list=Pages._mcp||[];if(!list.length||S.tab.mcp==='Catalog')return;
 const rows=[...el.querySelectorAll('.card.list .row')];rows.forEach((r,i)=>{if(list[i])r.dataset.mcp=list[i].name});
 explainFor('mcp',list.map(m=>({id:m.name,name:m.name,desc:(m.url||m.command||'')+' '+(m.tools||[]).map(t=>t.name||t).slice(0,12).join(', ')})),()=>paintExplained(el,'mcp','.row[data-mcp]',r=>r.dataset.mcp))}}

// Plugins, grouped by what kind of thing they are
const PLUGIN_GROUPS={browser:'Browser backends',dashboard_auth:'Sign-in methods',auth:'Sign-in methods',image_gen:'Image generation',image:'Image generation',memory:'Memory',model_providers:'Model providers',providers:'Model providers',cron:'Scheduling',platforms:'Channels',messaging:'Channels',tools:'Tools',observability:'Monitoring',context:'Context'};
const pluginGroup=x=>{const m=/\/plugins\/([^/]+)\//.exec(x.path||'');const g=m?m[1]:'';return PLUGIN_GROUPS[g]||(g?pretty(g):'Other')};
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{if((S.tab.plugins||'Installed')==='Browse')return base(p,el);
 setActions(`<button data-act="pl-rescan">${icon('refresh',16)}Rescan</button>`);
 const h=await H('/dashboard/plugins/hub');const list=h.plugins||[];const groups={};list.forEach(x=>(groups[pluginGroup(x)]||=[]).push(x));
 const row=(x,i)=>{const on=x.runtime_status==='enabled',v=ex('plugin',x.name);return `<div class="row" ${st(i)} data-pl="${esc(x.name)}"><div class="main-c"><span class="ic ${on?'blue':''}">${icon('layers',17)}</span><div class="txt"><b>${esc(v?.title||pretty(x.name))} <small class="realname">${esc(x.name)}</small></b><span title="${esc(x.description||'')}">${esc(v?.summary||(x.description||'').slice(0,120))}</span></div></div><div class="act">${toggle(on,x.name,'data-act="pl-toggle" data-name="'+esc(x.name)+'"')}<button class="ghost icon" data-menu="plugin" data-name="${esc(x.name)}" data-remove="${x.can_remove?1:''}" data-update="${x.can_update_git?1:''}" data-dash="${x.has_dashboard_manifest?1:''}" data-hidden="${x.user_hidden?1:''}" aria-label="More">${icon('more',18)}</button></div></div>`};
 const paint=()=>{if(route().page?.id!=='plugins')return;el.innerHTML=`${tabs('plugins',['Installed','Browse'])}${Object.entries(groups).sort((a,b)=>a[0]==='Other'?1:b[0]==='Other'?-1:a[0].localeCompare(b[0])).map(([g,xs])=>`<h2 class="ach-cat">${esc(g)} <small class="hint">${xs.length}</small></h2><div class="card list">${xs.map(row).join('')}</div>`).join('')}`;placePills()};
 paint();explainFor('plugin',list.map(x=>({id:x.name,name:x.name,desc:x.description||''})),paint)}}

/* ---------- Roles: define once (permissions, models, daily limit, how many agents), give each person one ---------- */
const roleSummary=ro=>{const n=(ro.caps||[]).length;return (n?n+' permission'+(n>1?'s':''):'chat only')+(ro.models?' · '+ro.models.length+' model'+(ro.models.length>1?'s':''):'')+(ro.limit?' · '+num(ro.limit.tokens)+'/day':'')+(ro.maxAgents?' · up to '+ro.maxAgents+' agents':'')};
async function roleDrawer(id){const d0=Pages._ppl||{};const ro=id?d0.roles[id]:{name:'',caps:[],models:null,limit:null,maxAgents:0};if(!Chat.models)await Chat.loadModels().catch(()=>{});const ms=Chat.models||[];
 const d=drawer(id?'Role · '+ro.name:'New role',`<label>Name</label><input id="roN" value="${esc(ro.name)}" placeholder="Family">
  <label>Allowed to</label>${Object.entries(d0.caps||{}).map(([k,l])=>`<label class="capt ${k==='unsafe'?'risky':''}"><input type="checkbox" data-rcap="${k}" ${(ro.caps||[]).includes(k)?'checked':''} ${k==='unsafe'&&S.me?.role!=='owner'?'disabled':''}><span>${esc(l)}</span></label>`).join('')}
  <p class="hint" style="margin:6px 0 0">Agent settings (config, keys, channels) always stay with admins.</p>
  <label>Models</label><label class="pick"><input type="checkbox" id="roAll" ${!ro.models?'checked':''}><span><b>Every model you have on</b></span></label>
  <div id="roList" ${!ro.models?'hidden':''}>${ms.map(m=>`<label class="pick"><input type="checkbox" value="${esc(m.provider+'|'+m.id)}" ${!ro.models||ro.models.includes(m.provider+'|'+m.id)?'checked':''}><span>${esc(m.label)} <small class="hint">${esc(m.providerName)}</small></span></label>`).join('')}</div>
  <div class="sched-row"><div><label>Daily limit</label><select id="roLim">${LIMITS.map(([v,l])=>`<option value="${v}" ${(ro.limit?.tokens||0)===v?'selected':''}>${l}</option>`).join('')}</select></div>
  <div><label>Agents they may own</label><select id="roMax">${[0,1,2,3,5,10].map(v=>`<option value="${v}" ${(ro.maxAgents||0)===v?'selected':''}>${v?v:'None'}</option>`).join('')}</select></div></div>
  ${id?`<button class="ghost" id="roDel" style="margin-top:20px;color:var(--bad)">${icon('trash',15)}Delete role</button>`:''}`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="roGo">${id?'Save':'Create role'}</button>`);
 d.querySelector('#roAll').onchange=e=>d.querySelector('#roList').hidden=e.target.checked;
 d.querySelector('#roGo').onclick=async()=>{const body={name:$('#roN').value.trim()||'Role',caps:[...d.querySelectorAll('[data-rcap]:checked')].map(i=>i.dataset.rcap),models:d.querySelector('#roAll').checked?null:[...d.querySelectorAll('#roList input:checked')].map(i=>i.value),limit:+$('#roLim').value?{tokens:+$('#roLim').value}:null,maxAgents:+$('#roMax').value};
  if(body.caps.includes('unsafe')&&!(ro.caps||[]).includes('unsafe')&&!await confirmBox('Give terminal and file tools?','People with this role can read everything on the box, including keys and other people\'s files.','Allow'))return;
  try{await UI('/ui/roles'+(id?'/'+id:''),{method:id?'PUT':'POST',body});closeLayers();toast(id?'Role saved':'Role created');reload()}catch(e){fail(e)}};
 d.querySelector('#roDel')?.addEventListener('click',async()=>{if(!await confirmBox('Delete '+ro.name+'?','People must have another role first.','Delete'))return;try{await UI('/ui/roles/'+id,{method:'DELETE'});closeLayers();toast('Role deleted');reload()}catch(e){fail(e)}})}
ACT['role-new']=()=>roleDrawer(null);ACT['role-open']=a=>roleDrawer(a.dataset.id);
{const people=PAGES.people;PAGES.people=async(p,el)=>{await people(p,el);const d=Pages._ppl||{};if(!d.roles)return;
 // each member: one role picker; per-person settings show only for Custom
 el.querySelectorAll('.person').forEach(card=>{const id=card.querySelector('[data-cap]')?.dataset.user;const u=(d.users||[]).find(x=>x.id===id);if(!u||u.role!=='member')return;
  const box=document.createElement('div');box.className='pcaps prole';box.innerHTML=`<div class="pshare"><b>Role</b><select style="width:auto" data-role="${esc(u.id)}">${Object.entries(d.roles).map(([k,ro])=>`<option value="${esc(k)}" ${u.roleId===k?'selected':''}>${esc(ro.name)}</option>`).join('')}<option value="custom" ${u.roleId==='custom'?'selected':''}>Custom</option></select></div><p class="hint" style="margin:2px 0 0">${u.roleId==='custom'?'Their own settings below.':esc(roleSummary(d.roles[u.roleId]||{}))}</p>`;
  const first=card.querySelector('.pshares');(first||card.lastChild).after(box);enhanceSelect(box.querySelector('select'));
  if(u.roleId!=='custom')card.querySelectorAll('.pcaps:not(.prole)').forEach(x=>x.hidden=true)});
 el.querySelectorAll('[data-role]').forEach(s=>s.onchange=async()=>{try{await UI('/ui/people/'+s.dataset.role,{method:'PATCH',body:{roleId:s.value==='custom'?null:s.value}});toast('Role changed');reload()}catch(e){fail(e)}});
 // the roles themselves
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginTop='16px';
 panel.innerHTML=`<div class="h-row"><h2 style="margin:0">Roles</h2><button data-act="role-new">${icon('plus',15)}New role</button></div><p class="sub">What each kind of person may do, which models they get, a daily limit and how many agents they may own.</p>
  <div class="role-grid">${Object.entries(d.roles).map(([k,ro],i)=>`<button class="card role-card" ${st(i)} data-act="role-open" data-id="${esc(k)}"><b>${esc(ro.name)}</b><span>${esc(roleSummary(ro))}</span><small>${(d.users||[]).filter(x=>x.roleId===k).length} people</small></button>`).join('')}</div>`;
 el.querySelector('.people-grid')?.after(panel)}}

/* ---------- Channels for the whole team: which agent answers each one, and moving it ---------- */
ACT['wh-new-pre']=0;
{const base=ACT['wh-new'];ACT['wh-new']=async a=>{try{S.agentsCache=((await H('/profiles')).profiles||[]).map(x=>x.name)}catch{}return base(a)}}
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;
 let d;try{d=await UI('/ui/channels')}catch{return}const agents=((await H('/profiles').catch(()=>({profiles:[]}))).profiles||[]).map(x=>x.name);
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginBottom='16px';
 panel.innerHTML=`<h2>Every agent's channels</h2><p class="sub">Each connection belongs to one agent, which answers it. Move one to another agent and its settings, WhatsApp login and approved people go along, so nobody sets it up twice.</p>
  ${d.channels.length?d.channels.map((c,i)=>`<div class="row" ${st(i)} style="padding:12px 12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="main-c">${chLogo(c.id,c.name)}<div class="txt"><b>${esc(c.name)}</b><span>${c.state==='connected'?'Connected':esc(pretty(c.state||'not running'))}${c.error?' · '+esc(c.error):''}</span></div></div>
   <div class="act"><span class="hint" style="margin:0">Answered by</span><select style="width:auto" data-chmove="${esc(c.id)}" data-from="${esc(c.agent)}">${agents.map(n=>`<option value="${esc(n)}" ${n===c.agent?'selected':''}>${esc(ident(n).name)}</option>`).join('')}</select></div></div>`).join(''):'<p class="hint">No channel is connected yet. Set one up below and it shows here for the whole team.</p>'}`;
 el.querySelector('.grid-cards')?.before(panel);panel.querySelectorAll('select').forEach(enhanceSelect);
 panel.querySelectorAll('[data-chmove]').forEach(s=>s.onchange=async()=>{const to=s.value,from=s.dataset.from;if(to===from)return;
  if(!await confirmBox('Move this channel to '+ident(to).name+'?',ident(to).name+' will answer it from now on. Its settings and approved people move along; the channel restarts for a few seconds.','Move',false)){s.value=from;return}
  try{await post(UI,'/ui/channels/move',{platform:s.dataset.chmove,from,to});toast('Moved. '+ident(to).name+' answers it now.');reload()}catch(e){fail(e);s.value=from}})}}
