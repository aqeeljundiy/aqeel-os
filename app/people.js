// People: who can sign in to aqeelOS, what they may do, and which agents are shared with them.
// The server enforces every rule (users.mjs); this file only shows the right things.
// A person's picture, or their first letter.
const personAva=(u,s=32)=>personAvatar(u,s,{title:false});   // people: the shared component (core.js), same sizes and shape as agents
// An agent's picture, or its first letter on the brand blue.
const agentAva=a=>agentAvatar(a,28,{title:false});
const LEVEL_LABEL={chat:'Can chat',edit:'Can edit',owner:'Owner'};
const ROLE_LABEL={owner:'Owner',admin:'Admin',member:'Member'};
// Tools a family member's agent never gets: they reach the whole box.
const UNSAFE_TOOLSETS=['terminal','file','code_execution','computer_use'];

async function loadMe(){
 try{S.me=await UI('/ui/me')}catch{S.me={admin:true,role:'owner',name:'',agents:{}}}
 try{S.supervised=!!(await UI('/ui/supervision')).on}catch{S.supervised=false}
 try{S.defaults=await UI('/ui/defaults')}catch{S.defaults={}}
 if(S.me?.admin!==false)UI('/ui/accounts/allow').then(r=>{S.acctAllow=r.allow||[]}).catch(()=>{});
 await Prefs.load(S.me?.id||S.me?.name||'owner');
 applyRole();
 if(!S.me.admin&&typeof FILE_HOME!=='undefined')FILE_HOME=S.me.home;
}
// A member whose remembered agent is not theirs (or none yet): their own lead agent, else the first one shared with them.
// '' is the main agent, also when nothing is shared yet (noAgent says which).
function memberAgent(){const l=S.me?.agents||{},n=S.me?.lead&&l[S.me.lead]?S.me.lead:Object.keys(l)[0]||'';return n==='default'?'':n}
// a member with no agent they may use: their lead is still being made, or nothing is shared with them yet
const noAgent=()=>!!S.me&&S.me.admin===false&&!Object.keys(S.me.agents||{}).length;
const NO_AGENT_TEXT='No agent is shared with you yet. Ask an admin to share one. This page updates by itself.';
const NO_AGENT_MAKE='You have no agent yet. Create your own, or ask an admin to share one.';
const noAgentBox=()=>S.me?.canMake?emptyBox('No agent yet',NO_AGENT_MAKE,'<button class="primary" data-act="prof-new">'+icon('plus',16)+'Create your agent</button>'):emptyBox('No agent yet',NO_AGENT_TEXT);
// Members see Chat and their own Files; admins get the People page.
// The full navigation is copied once, so each call (switching agent or account) starts from all sections again.
let ALL_SECTIONS=null;
function applyRole(){
 ALL_SECTIONS??=structuredClone(SECTIONS);SECTIONS.splice(0,SECTIONS.length,...structuredClone(ALL_SECTIONS));
 if(S.me?.admin){if(typeof FILE_HOME!=='undefined')FILE_HOME=S.me.home;const sys=SECTIONS.find(s=>s.id==='system');if(sys&&!sys.pages.some(p=>p.id==='people'))sys.pages.unshift({id:'people',label:'People',icon:'user',desc:'Who can sign in, what they can do, and which agents they can use.'});return}
 // an agent's owner manages its schedules, skills and connected apps whatever their role (users.mjs, OWNER_CAPS)
 const owns=Object.values(S.me?.agents||{}).includes('owner');
 const has=k=>(S.me?.caps||[]).includes(k)||owns&&['schedules','skills','mcp'].includes(k),editsAny=Object.values(S.me?.agents||{}).some(l=>l!=='chat');
 const pg=(sec,id,extra)=>({...SECTIONS.find(s=>s.id===sec).pages.find(p=>p.id===id),...extra});
 const out=[SECTIONS.find(s=>s.id==='chat')];
 // the same order as admins' menu: Chat, Agents, Code, Automations, Abilities, Models, Help
 if(has('create')||editsAny)out.push({id:'agents',label:'Agents',icon:'user',pages:[pg('agents','profiles',{desc:'Agents you can use and change.'})]});
 // Code on their own computer, with the agents shared with them (online projects stay with admins: the AI box has one Linux user)
 {const c=SECTIONS.find(s=>s.id==='code');if(c)out.push(c)}
 if(has('schedules'))out.push({id:'automations',label:'Automations',icon:'zap',pages:[pg('automations','schedules')]});
 out.push({id:'abilities',label:'Abilities',icon:'puzzle',pages:[...(has('skills')?[pg('abilities','skills')]:[]),...(has('mcp')?[pg('abilities',SECTIONS.find(x=>x.id==='abilities')?.pages.some(q=>q.id==='connections')?'connections':'mcp')]:[])   /* Connected apps became Connections (1 Nov 2026): members with the apps right get the new page */,...(owns?[pg('abilities','plugins',{desc:'Add-ons for the agents you own. Turn one on for an agent there.'})]:[])   /* personal add-ons (11 Nov 2026) */,pg('agents','files',{desc:'Your own folder. Your agents can read what you put here.'})]});
 // their Usage page: the same page as admins', for them only, with how full each AI account is (1 Nov 2026; it was called Accounts)
 if(has('usage'))out.push({id:'models',label:'Models',icon:'cpu',pages:[{id:'usage',label:'Usage',icon:'chart',desc:'What you used, and how much of each AI account is used.'}]});
 {const h=SECTIONS.find(s=>s.id==='help');if(h)out.push(h)}   // Help is everyone's, last in the menu
 out.forEach((s,i)=>{if(s.id!=='chat')s.key=String(i+1)});
 SECTIONS.splice(0,SECTIONS.length,...out);
}

/* ---------- invite link: /#invite/<code> ---------- */
async function inviteView(root,code){
 let info=null;try{const r=await fetch('/auth/invite?code='+encodeURIComponent(code));if(r.ok)info=await r.json()}catch{}
 root.innerHTML=`<div class="signin"><form class="card" id="inv" novalidate><span class="wordmark"><img class="mark" src="${Brand.mark()}" alt="">${esc(Brand.name)}</span>
  ${info?`<h1>You're invited</h1><p>Pick a password to start using aqeelOS.</p><label for="ivN">Your name</label><input id="ivN" autocomplete="name" value="${esc(info.name||'')}" placeholder="Sarah"><label for="ivE">Email</label><input id="ivE" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(info.email||'')}" placeholder="sarah@example.com"><p class="hint ac-hint">You sign in with this.</p>
  <label for="ivP">Password</label><input id="ivP" type="password" autocomplete="new-password" placeholder="At least 8 characters"><p class="err" id="err" role="alert"></p><button class="primary" type="submit">Join aqeelOS</button>`
  :`<h1>This link doesn't work</h1><p>It has expired or was already used. Ask for a new invite.</p><a class="btn" href="/#signin" style="margin-top:12px">Go to sign in</a>`}</form></div>`;
 const f=$('#inv');if(!info)return;$(!info.name?'#ivN':!info.email?'#ivE':'#ivP').focus();
 f.onsubmit=async e=>{e.preventDefault();const err=$('#err'),b=f.querySelector('button');b.disabled=true;
  try{const r=await fetch('/auth/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:$('#ivN').value.trim(),email:$('#ivE').value.trim(),password:$('#ivP').value})});const d=await r.json().catch(()=>({}));
   if(!r.ok){err.textContent=d.error||'That did not work.';f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');return}
   S.signedIn=true;history.replaceState(null,'','/#/chat');await boot()}finally{b.disabled=false}}}

/* ---------- People page (System › People) ---------- */
PAGES.people=async(p,el)=>{const gone=pageTok(el);
 setActions(`<button class="primary" data-act="ppl-invite">${icon('plus',16)}Invite someone</button>`);
 const [d,pr]=await Promise.all([UI('/ui/people'),H('/profiles').catch(()=>({profiles:[]}))]);if(gone())return;Pages._ppl=d;Pages._agents=(pr.profiles||[]).map(x=>x.name);
 const inv=(d.invites||[]).map((x,i)=>`<div class="row" ${st(i)} style="padding:12px 12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="txt"><b>${esc(x.name||'Anyone with the link')} · ${esc(ROLE_LABEL[x.role])}</b><span>Expires ${new Date(x.expires).toLocaleDateString()}${Object.keys(x.agents||{}).length?' · '+Object.keys(x.agents).map(a=>esc(ident(a).name)).join(', '):''}</span></div><div class="act"><button data-act="ppl-copy" data-code="${esc(x.code)}">${icon('copy',15)}Copy link</button><button class="ghost" data-act="ppl-uninvite" data-code="${esc(x.code)}" aria-label="Cancel invite">${icon('x',16)}</button></div></div>`).join('');
 const exp=(d.expired||[]).map((x,i)=>`<div class="row inv-expired" ${st(i)} style="padding:12px 12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="txt"><b>${esc(x.name||'Anyone with the link')} · ${esc(ROLE_LABEL[x.role])}</b><span>Expired ${new Date(x.expired).toLocaleDateString()}</span></div><div class="act"><button data-act="ppl-renew" data-code="${esc(x.code)}">${icon('refresh',15)}Renew for 7 days</button><button class="ghost" data-act="ppl-uninvite" data-code="${esc(x.code)}" aria-label="Delete invite">${icon('x',16)}</button></div></div>`).join('');
 // many people: a search box like the Connections page (it only hides cards, so a card drawn again in place still filters)
 const all=[d.owner,...d.users],many=all.length>8;
 el.innerHTML=`${many?`<div class="toolbar ppl-bar"><div class="search${S.pplQ?' has-q':''}">${icon('search',16)}<input id="pplQ" type="search" enterkeyhint="search" placeholder="Search people" value="${esc(S.pplQ||'')}" aria-label="Search people"><button class="ghost icon s-clear" data-act="ppl-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div></div>`:''}
  <div class="people-grid">${all.map((u,i)=>pplCard(d,u,Math.min(i,12))).join('')}<div class="state-box ppl-none" hidden>Nobody matches “<b></b>”. <button class="link" data-act="ppl-clear">Clear the search</button></div></div>
  ${inv||exp?`<div class="panel card" style="margin-top:16px"><h2>Waiting to join</h2><p class="sub">Links work once and expire after 7 days. Renew an expired one to send the same link again.</p>${inv}${exp}</div>`:''}
  <div class="panel card" style="margin-top:16px"><h2>How sharing works</h2><p class="sub" style="margin-bottom:0">Two layers. <b>Each person has a role</b> (Roles above): what they may do, which models they get, a daily limit and how many agents they may own. <b>Each agent is shared per person</b>: Can chat uses it, Can edit also changes it within their role, Owner can also delete or give it away. Admins see and manage every agent and can read the chats of members, but not write in them; each chat they open is logged. Members see only their own agents and chats, and what is shared with them.</p></div>`;
 if(many){const q=el.querySelector('#pplQ'),grid=el.querySelector('.people-grid');let t;pplFilter();
  q.oninput=()=>{q.closest('.search').classList.toggle('has-q',!!q.value);clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected)return;S.pplQ=q.value;smoothHeight(grid,pplFilter)},100)}}
 const pn=document.querySelector('.drawer.ppl-panel:not(.closing)');if(pn)pplRepaint(pn);   // drawn again (More, a share): the open panel follows
};
function pplFilter(){const q=document.querySelector('#pplQ')?(S.pplQ||'').trim().toLowerCase():'';let n=0;
 document.querySelectorAll('.people-grid .person').forEach(c=>{const ok=!q||(c.dataset.q||'').includes(q);c.hidden=!ok;if(ok)n++});
 const none=document.querySelector('.ppl-none');if(none){none.hidden=!!n;none.querySelector('b').textContent=S.pplQ||''}}
ACT['ppl-clear']=()=>{const q=document.querySelector('#pplQ');if(!q)return;q.value='';q.dispatchEvent(new Event('input'));q.focus()};
const agentPicker=(id,taken=[])=>`<div id="${id}">${(Pages._agents||[]).filter(a=>!taken.includes(a)).map(a=>`<label class="pick"><input type="checkbox" value="${esc(a)}">${agentAva(a)}<span>${esc(ident(a).name)}</span><select style="width:auto">${Object.entries(LEVEL_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`).join('')||'<p class="hint">Every agent is already shared.</p>'}</div>`;
const pickedAgents=id=>Object.fromEntries([...$$('#'+id+' .pick')].filter(l=>l.querySelector('input').checked).map(l=>[l.querySelector('input').value,l.querySelector('select').value]));
// A new agent for a family member: own name, the main AI account, no terminal / files / computer use.
async function makeSafeAgent(name){
 const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'family';
 let id=slug,n=2;while((Pages._agents||[]).includes(id))id=slug+'-'+n++;
 await post(H,'/profiles',{name:id,clone_from_default:false,no_skills:false});
 await post(UI,'/ui/accounts/setup-agent',{name:id}).catch(()=>{});
 await post(UI,'/ui/agent-safe',{agent:id}).catch(()=>{});   // locked on every channel (chats, WhatsApp, schedules), and kept locked
 await put(UI,'/ui/identities/'+encodeURIComponent(id),{name,title:''}).catch(()=>{});
 await loadIdentities();return id}
ACT['ppl-invite']=()=>{const d=drawer('Invite someone',`<label>Their name</label><input id="ivName" placeholder="Sarah"><label>Their email (optional)</label><input id="ivMail" type="email" placeholder="sarah@example.com"><p class="hint" style="margin:4px 0 0">We email them the invite link. You also get it to copy.</p>
  <label>Role</label><select id="ivRole">${Object.entries(Pages._ppl?.roles||{}).map(([k,ro])=>`<option value="${esc(k)}">${esc(ro.name)}: ${esc(roleSummary(ro))}</option>`).join('')}${S.me?.role==='owner'?'<option value="admin">Admin: can do everything</option>':''}</select>
  <div id="ivAgents"><label>Agents they can use</label><div class="ab-host iv-ab"></div>
  <label class="pick" style="margin-top:10px"><input type="checkbox" id="ivNew" checked><span><b>Also make them their own agent</b><br><small class="hint">Uses your main AI account. No terminal, files or computer use.</small></span></label>
  <input id="ivNewName" placeholder="Name for their agent, e.g. Sarah's assistant" style="margin-top:6px"></div>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="ivGo">Create invite link</button>`);
 // agents: the same block as sharing an agent (access-block.js): search to add, then each picked agent with one menu
 // (Can chat, Can edit, Remove). Nothing is saved until Create invite link; it sends {agent: level} as before.
 const picked={},host=d.querySelector('.iv-ab');
 const paintAB=(refocus=false)=>{if(!host.isConnected)return;
  AccessBlock.live(host,{items:Object.entries(picked).map(([a,l])=>({id:a,name:ident(a).name,level:l})),levels:{chat:LEVEL_LABEL.chat,edit:LEVEL_LABEL.edit},
   choices:(Pages._agents||[]).filter(a=>!picked[a]).map(a=>({id:a,name:ident(a).name})),search:'Add agents',
   onAdd:a=>{picked[a]='chat';paintAB(true)},onLevel:(a,l)=>{picked[a]=l;paintAB()},onRemove:a=>{delete picked[a];paintAB()}});
  host.querySelector('.ab-lbl')?.remove();   // the field's own label says it
  if(!Object.keys(picked).length)host.querySelector('.ab-list').innerHTML='<p class="hint iv-none">None yet. Type a name above to add one.</p>';
  if(refocus)host.querySelector('.ab-find input')?.focus()};
 paintAB();
 const sync=()=>{$('#ivAgents').hidden=$('#ivRole').value==='admin';$('#ivNewName').hidden=!$('#ivNew').checked};$('#ivRole').onchange=sync;$('#ivNew').onchange=sync;
 $('#ivName').oninput=e=>{const v=e.target.value.trim();$('#ivNewName').placeholder=v?v+"'s assistant":"Name for their agent"};
 d.querySelector('#ivGo').onclick=async()=>{const name=$('#ivName').value.trim(),pick=$('#ivRole').value,role=pick==='admin'?'admin':'member',roleId=pick==='admin'?null:pick,caps=[];const b=d.querySelector('#ivGo');b.disabled=true;
  try{const agents=role==='admin'?{}:{...picked};let ownAgent=null;
   if(role!=='admin'&&$('#ivNew').checked){const an=$('#ivNewName').value.trim()||(name?name+"'s assistant":'Family assistant');b.textContent='Making their agent…';const id=await makeSafeAgent(an);agents[id]='owner';ownAgent=id}
   const inv=await post(UI,'/ui/people/invite',{name,role,roleId,caps,agents,ownAgent,noLead:role!=='admin'&&!$('#ivNew').checked,email:$('#ivMail').value.trim()});const to=$('#ivMail').value.trim();closeLayers();
   if(to){try{await post(UI,'/ui/people/invite/'+inv.code+'/email',{to,link:publicBase()+'/#invite/'+inv.code});toast('Invite emailed to '+to+'. The link is copied too.')}catch(e){toast('Email failed ('+(e.message||e)+'). The link is copied instead.','err')}}
   await copyInvite(inv.code);reload()}catch(e){fail(e)}finally{b.disabled=false}}};
async function copyInvite(code){const link=publicBase()+'/#invite/'+code;if(await copyText(link,''))toast('Invite link copied. Send it to them.');else await promptBox('Invite link','Copy this link and send it',link,'Done')}
ACT['ppl-copy']=a=>copyInvite(a.dataset.code);
ACT['ppl-uninvite']=async a=>{try{await del(UI,'/ui/people/invite/'+a.dataset.code);toast('Invite cancelled');reload()}catch(e){fail(e)}};
ACT['ppl-share']=a=>{const id=a.dataset.id;const taken=Object.entries(Pages._ppl?.shares||{}).filter(([,m])=>m[id]).map(([x])=>x);
 const d=drawer('Share an agent',agentPicker('shPick',taken),`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="shGo">Share</button>`);
 d.querySelector('#shGo').onclick=async()=>{try{for(const [agent,level] of Object.entries(pickedAgents('shPick')))await put(UI,'/ui/people/share',{agent,user:id,level});closeLayers();toast('Shared');reload()}catch(e){fail(e)}}};
Pages.personMenu=el=>{const u=(Pages._ppl?.users||[]).find(x=>x.id===el.dataset.id);if(!u)return;
 menu(el,[...(S.me?.role==='owner'?[{label:u.role==='admin'?'Make member':'Make admin',icon:'user',run:async()=>{try{await UI('/ui/people/'+u.id,{method:'PATCH',body:{role:u.role==='admin'?'member':'admin'}});reload()}catch(e){fail(e)}}},'-']:[]),
  ...PeopleAdmin.items(u),'-',
  {label:'Remove '+u.name,icon:'trash',danger:true,run:async()=>{if(!await confirmBox('Remove '+u.name+'?','They can no longer sign in. Their chats stay on the box.','Remove'))return;try{await del(UI,'/ui/people/'+u.id);toast(u.name+' removed');reload()}catch(e){
   // they still own private agents: only the owner of aqeelOS may take those over, and only when they say so
   if(e.status!==409||e.data?.code!=='owns-agents'||S.me?.role!=='owner')return fail(e);const n=(e.data.agents||[]).map(a=>ident(a).name).join(', ');
   if(!await confirmBox('Take over '+n+'?',u.name+' owns '+n+', private to them. Removing them makes you the owner.','Take over and remove'))return;
   try{await del(UI,'/ui/people/'+u.id+'?agents=take');toast(u.name+' removed. You now own '+n);reload()}catch(e2){fail(e2)}}}}])};
ACT['me-profile']=()=>{const me=S.me||{};
 const d=drawer('Your profile',`<div class="prof-pic"><div id="pfAva" class="ident-ava-box">${personAva(me,72)}</div><div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="pfPic">${icon('upload',15)}Upload photo</button><button type="button" class="ghost" id="pfPicDel" ${me.avatar||me.emoji?'':'hidden'}>${me.avatar?'Remove photo':'Remove emoji'}</button></div><p class="hint" style="margin:6px 0 0">JPG, PNG or WebP. You place it in the circle next. Or pick an emoji below.</p></div></div>
  <div class="ava-crop" id="pfCrop"></div><div id="pfEmo"${EMOJI.length?'':' hidden'}></div>
  <label>Name</label><input id="pfName" value="${esc(me.name||'')}" autocomplete="name"><label>Username</label><input id="pfUser" value="${esc(me.username||'')}" autocomplete="username" autocapitalize="none" spellcheck="false"><p class="hint" style="margin:4px 0 0">Your handle, shown to others. You sign in with your email.</p>
  <h3 class="prof-h">Email</h3><label>Email address (you sign in with it)</label><div class="row-in"><input id="pfMail" type="email" value="${esc(me.email||'')}" placeholder="you@example.com" autocomplete="email"><span class="chip ${me.email?(me.emailVerified?'ok':'warn'):''}" id="pfMailState">${me.email?(me.emailVerified?'Confirmed':'Not confirmed'):'None'}</span></div>
  <div id="pfVerify" ${me.email&&!me.emailVerified?'':'hidden'}><label>Code from the email</label><div class="row-in"><input id="pfCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"><button id="pfCodeGo">Confirm</button><button class="ghost" id="pfResend">Send again</button></div><p class="hint" style="margin:4px 0 0">Check spam too. Codes work for 10 minutes.</p></div>
  <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px">Ask for an email code when I sign in ${toggle(!!me.twoStep,'Two-step sign-in','id="pf2s" '+(me.emailVerified?'':'disabled'))}</label>
  ${me.role==='owner'?`<h3 class="prof-h">Recovery code</h3><p class="hint" style="margin:0 0 8px">${me.recovery?'You have one. It signs you in once if you lose your password or email. A new one replaces it.':'You have none yet. Make one and keep it safe: it signs you in once if you lose your password or email.'}</p><button class="ghost" data-act="me-recovery">${icon('key',15)}${me.recovery?'Make a new recovery code':'Make a recovery code'}</button>`:''}
  <h3 class="prof-h">Devices</h3><p class="hint" style="margin:0 0 8px">Signed in on a computer or phone you no longer use?</p><button class="ghost" data-act="sign-out-all">${icon('logout',15)}Sign out on every device</button>
  <h3 class="prof-h">Password</h3><label>Current password</label><input id="pwC" type="password" autocomplete="current-password"><label>New password</label><input id="pwN" type="password" autocomplete="new-password" placeholder="At least 8 characters">
  <p class="hint" style="margin:6px 0 0">Leave both empty to keep your password.</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="pfGo">Save</button>`);
 // your picture saves as soon as you choose it (photo, emoji or removing either) and changes in place everywhere on screen;
 // a photo and an emoji replace each other, and without either your initial shows
 const pfPic=d.querySelector('#pfPic'),rm=d.querySelector('#pfPicDel');
 const paintMe=()=>{d.querySelector('#pfAva').innerHTML=personAvatar(S.me,72,{title:false,anim:true});rm.hidden=!S.me.avatar&&!S.me.emoji;rm.textContent=S.me.avatar?'Remove photo':'Remove emoji';setE(S.me.avatar?null:S.me.emoji||null);repaintPeople(S.me.id,{avatar:S.me.avatar,emoji:S.me.emoji})};
 const saved=r=>{S.me={...S.me,avatar:r.avatar||null,emoji:r.emoji||null};paintMe()};
 const setE=EMOJI.length?emojiPicker(d.querySelector('#pfEmo'),{cur:me.avatar?null:me.emoji||null,label:'Or an emoji',onPick:async e=>{try{saved(await put(UI,'/ui/me/emoji',{emoji:e}));toast('Picture updated')}catch(er){fail(er)}}}):()=>{};
 pfPic.onclick=()=>pickFile(AVA_ACCEPT,async f=>{pfPic.disabled=true;const b=await avatarCrop(d.querySelector('#pfCrop'),f);if(!b){pfPic.disabled=false;return}
  try{saved(await call('','/ui/me/avatar',{method:'PUT',headers:{'content-type':b.type},body:b}));toast('Photo updated')}catch(e){fail(e)}pfPic.disabled=false});
 rm.onclick=async()=>{try{saved(S.me.avatar?await del(UI,'/ui/me/avatar'):await put(UI,'/ui/me/emoji',{emoji:''}));toast('Picture removed')}catch(e){fail(e)}};
 let vkey=null;const showVerify=on=>{d.querySelector('#pfVerify').hidden=!on};
 d.querySelector('#pfCodeGo').onclick=async()=>{if(!vkey){const r=await post(UI,'/ui/me/email/resend').catch(e=>{fail(e)});if(!r)return;vkey=r.key;return toast('New code sent. Enter it.')}
  try{await post(UI,'/ui/me/email/verify',{key:vkey,code:$('#pfCode').value});await loadMe();toast('Email confirmed');closeLayers();ACT['me-profile']()}catch(e){fail(e)}};
 d.querySelector('#pfResend').onclick=async()=>{try{vkey=(await post(UI,'/ui/me/email/resend')).key;toast('Code sent. Check spam too.')}catch(e){fail(e)}};
 d.querySelector('#pf2s').onchange=async e=>{try{
   // turning it off asks for the password, so a signed-in browser left open cannot switch it off
   let current;if(!e.target.checked){current=await promptBox('Turn off two-step sign-in','Your current password','','Turn off','password');if(current===null){e.target.checked=true;return}}
   await put(UI,'/ui/me/two-step',{on:e.target.checked,current});await loadMe();toast(e.target.checked?'Two-step sign-in on':'Two-step sign-in off')}catch(er){e.target.checked=!e.target.checked;fail(er)}};
 d.querySelector('#pfGo').onclick=async()=>{const b=d.querySelector('#pfGo');b.disabled=true;try{
   const mailNow=$('#pfMail').value.trim().toLowerCase();if(mailNow!==(me.email||'')){
    // changing or clearing a set email (it turns two-step off) needs the current password: the one typed below, or asked now
    const current=me.email?($('#pwC').value||await promptBox(mailNow?'Change your email':'Remove your email','Your current password','',mailNow?'Change':'Remove','password')):'';if(current===null){b.disabled=false;return}
    const r=await put(UI,'/ui/me/email',{email:mailNow,current}).catch(e=>{fail(e);return null});if(!r&&me.email){b.disabled=false;return}if(r?.key){vkey=r.key;await loadMe();showVerify(true);d.querySelector('#pfMailState').textContent='Not confirmed';d.querySelector('#pfMailState').className='chip warn';toast('We sent a code to '+mailNow+'. Enter it below.');b.disabled=false;return}}
   const name=$('#pfName').value.trim(),username=$('#pfUser').value.trim().toLowerCase();if(name!==me.name||username!==(me.username||''))await put(UI,'/ui/me',{name,username});
   if($('#pwC').value||$('#pwN').value)await put(UI,'/ui/me/password',{current:$('#pwC').value,next:$('#pwN').value});
   await loadMe();closeLayers();toast('Profile saved');if(route().page?.id==='people')reload()}catch(e){fail(e)}finally{b.disabled=false}}};

/* ---------- members on the Agents page: only what their share level and permissions allow ---------- */
{const full=Pages.profileMenu;
 Pages.profileMenu=el=>{if(S.me?.admin!==false)return full(el);
  const lvl=S.me.agents?.[el.dataset.name]||'chat',edit=lvl!=='chat',has=k=>(S.me.caps||[]).includes(k);
  const ok=new Set(['Manage here',...(edit?['Edit identity','Rename','Edit description','Write description for me','Edit SOUL']:[]),...(edit&&has('models')?['Change model']:[]),...(lvl==='owner'?['Delete']:[])]);
  const real=window.menu;window.menu=(a,items,...rest)=>{window.menu=real;const list=items.filter(i=>i&&(i==='-'||i.header||ok.has(i.label)));return real(a,list.filter((i,n)=>i!=='-'||(n>0&&list[n-1]!=='-'&&n<list.length-1)),...rest)};
  try{full(el)}catch(e){window.menu=real;throw e}}}

ACT['tool-off']=a=>{Chat.tools.splice(+a.dataset.i,1);Chat.paintTools()};

/* ---------- Agents page (10 Nov 2026, owner: simple, the same at 3 agents or 100): one card for every agent. Picture,
   name (a "Main agent" badge on the main one only), one line of what it does, one quiet line "Online · Owner: Aisar", and
   Chat on every card. A search box, and Grid / List: the same items drawn as cards or as Connections-style rows, so
   switching only changes a class. The choice is remembered; with more than 12 agents it starts as List. Private agents
   (owned by someone else, not shared) stay in the list, locked. ---------- */
const agView=n=>{const v=store.get('agents-view',null);return v==='grid'||v==='list'?v:n>12?'list':'grid'};
function agItem(x,o,i){const id=ident(x.name),locked=o.access===null&&o.private,owner=o.invitee?o.invitee.name+' · invited':o.owner?(o.owner.id===S.me?.id?'You':o.owner.name):'';
 const desc=locked?`<p class="ag-desc">Only ${esc(owner||'its owner')} and the people they share it with can open it.</p>`
  :x.description?`<p class="ag-desc">${esc(x.description)}</p>`
  :mayEdit(x.name)?`<p class="ag-desc hint"><a href="#" data-act="agent-describe" data-name="${esc(x.name)}">Add a description</a></p>`:'<p class="ag-desc hint">No description yet.</p>';
 const shared=(o.shared||[]).length,q=[id.name,x.name,x.description||'',owner,o.owner?.name||'',x.is_default?'main agent':''].join(' ').toLowerCase();
 return `<div class="card tile agent-card ag-item ${locked?'locked':''}" ${st(Math.min(i,12))} ${locked?`data-act="agent-locked" data-owner="${esc(o.owner?.name||'')}"`:`data-act="agent-card" tabindex="0" role="button" aria-label="Chat with ${esc(id.name)}"`} data-name="${esc(x.name)}" data-q="${esc(q)}">
  <div class="ag-main">${agentAvatar(x.name,40,{plain:locked,title:false})}<div class="ag-txt"><h3><span class="ag-n">${esc(id.name)}</span>${x.is_default?'<span class="ag-badge">Main agent</span>':''}</h3>${desc}</div></div>
  <div class="ag-meta"><span class="ag-st${locked?'':x.gateway_running?' on':' off'}">${locked?icon('lock',12):'<i class="dot"></i>'}${locked?'Private':x.gateway_running?'Online':'Offline'}</span><span class="ag-own"${shared?` title="Shared with ${shared===1?'1 person':shared+' people'}"`:''}>${owner?'<span class="ag-ol">Owner: </span>'+esc(owner):'No owner'}</span></div>
  <div class="agent-tags">${!locked&&x.description_auto&&x.description?'<span class="chip" title="aqeelOS wrote this description. Read it and change it if it is off; editing it removes this note.">Written for you · check it</span>':''}</div>
  <div class="tile-foot agent-foot">${locked?`<span class="ag-locked">${icon('lock',14)}Private</span>`:`<span class="agent-go">${icon('chat',14)}Chat</span><button class="ghost icon agent-gear" data-menu="profilecard" data-name="${esc(x.name)}" aria-label="Settings for ${esc(id.name)}" title="Settings">${icon('settings',18)}</button>`}</div></div>`}
// search: hide what doesn't match (cards keep whatever was added to them after drawing, like Finish setup)
function agFilter(el){const q=(S.agQ||'').trim().toLowerCase(),items=[...el.querySelectorAll('.ag-item')];let n=0;
 for(const c of items){const ok=!q||c.dataset.q.includes(q);c.hidden=!ok;if(ok)n++}
 const none=el.querySelector('.ag-none');if(none){none.hidden=!!n;none.querySelector('b').textContent=S.agQ||''}}
PAGES.profiles=async(p,el)=>{const stale=pageTok(el);
 const pr=await H('/profiles');if(stale())return;Pages._profiles=pr.profiles||[];
 const own=await UI('/ui/agents?names='+encodeURIComponent(Pages._profiles.map(x=>x.name).join(','))).catch(()=>({}));if(stale())return;Pages._own=own;
 const list=Pages._profiles.filter(x=>own[x.name]||S.me?.admin!==false);
 setActions(`<span class="head-count">${esc(plural(list.length,'agent'))}</span>`+(S.me?.admin===false&&!(S.me.caps||[]).includes('create')?'':`<button class="primary" data-act="prof-new">${icon('plus',16)}New agent</button>`));
 // nothing listed (never a blank page): a member's own agent may still be getting ready
 if(!list.length){el.innerHTML=emptyBox('No agents yet',S.me?.admin===false?'Agents shared with you show here. A new one can take a minute to appear. Ask an admin if none does.':'Make your first one with New agent.');return}
 // the main agent first, then as the server lists them
 list.sort((a,b)=>(b.is_default?1:0)-(a.is_default?1:0));
 const view=agView(list.length),wrap=v=>v==='list'?'ag-wrap card list ag-list':'ag-wrap grid-cards ag-grid';
 el.innerHTML=`<div class="toolbar ag-bar"><div class="search${S.agQ?' has-q':''}">${icon('search',16)}<input id="agQ" type="search" enterkeyhint="search" placeholder="Search agents" value="${esc(S.agQ||'')}" aria-label="Search agents"><button class="ghost icon s-clear" data-act="ag-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div>
  <div class="seg-mini ag-view" role="group" aria-label="Show as">${['grid','list'].map(v=>`<button type="button" data-v="${v}" class="${v===view?'on':''}" aria-pressed="${v===view}">${v==='grid'?'Grid':'List'}</button>`).join('')}</div></div>
  <div class="${wrap(view)}"><div class="cn-head ag-head" aria-hidden="true"><span>Agent</span><span>Owner</span><span>Status</span><span></span></div>${list.map((x,i)=>agItem(x,own[x.name]||{},i)).join('')}<div class="state-box ag-none" hidden>Nothing matches “<b></b>”. <button class="link" data-act="ag-clear">Clear the search</button></div></div>`;
 const box=el.querySelector('.ag-wrap'),q=el.querySelector('#agQ');agFilter(el);
 let t;q.oninput=()=>{q.closest('.search').classList.toggle('has-q',!!q.value);clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected)return;S.agQ=q.value;smoothHeight(box,()=>agFilter(el))},100)};
 el.querySelectorAll('.ag-view [data-v]').forEach(b=>b.onclick=()=>{const v=b.dataset.v;if(box.classList.contains(v==='list'?'ag-list':'ag-grid'))return;store.set('agents-view',v);
  el.querySelectorAll('.ag-view [data-v]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b)});
  smoothHeight(box,()=>{box.className=wrap(v);box.querySelectorAll('.ag-item').forEach(c=>{c.style.animation='none';void c.offsetWidth;c.style.animation='';c.style.animationDelay='0ms'})})})};
ACT['ag-clear']=()=>{const q=document.querySelector('#agQ');if(!q)return;q.value='';q.dispatchEvent(new Event('input'));q.focus()};
ACT['agent-locked']=a=>toast('This agent is private to '+(a.dataset.owner||'its owner')+'. Ask them to share it with you.');
/* ---------- Sharing an agent (1 Nov 2026): one home, Edit agent › Sharing. People › Share an agent and Change open it
   there; it was also a window of its own and a ⋯ item, three ways to do one thing. A person owns an agent; it is shared
   with others at a level. Each change saves at once and the tab draws again in place (no window closing and opening). */
ACT['agent-share']=(name,opt={})=>editAgent(name,'Sharing',opt);
async function shareInto(box,name,opt={}){const gone=pageRun(box);let people=[];try{people=await UI('/ui/people/list')}catch(e){if(!gone())box.innerHTML=errLine('the people this agent can be shared with');return}
 const o=(await UI('/ui/agents?names='+encodeURIComponent(name)).catch(()=>({})))[name]||{};if(gone())return;const others=people.filter(x=>x.id!==o.owner?.id);
 const notYet=others.filter(x=>!(o.shared||[]).some(s=>s.id===x.id));
 // the same block as every other "who can use this" (access-block.js): people as chips, each with what they may do
 const call=async(path,body,msg)=>{await UI('/ui/agents/'+encodeURIComponent(name)+path,{method:'PUT',body});toast(msg);if(route().page?.id==='profiles'||route().page?.id==='people')laterReload(400);if(box.isConnected)shareInto(box,name)};
 // People › Share an agent: the person picked there is added straight away, at Can chat
 if(opt.add&&notYet.some(x=>x.id===opt.add)){try{await call('/share',{user:opt.add,level:'chat'},'Shared with '+notYet.find(x=>x.id===opt.add).name+' · Can chat')}catch(e){fail(e)}return}
 box.innerHTML=(o.canPrivate?`<div class="priv-row"><div><b>Private</b><p class="hint" style="margin:2px 0 0">${o.privateOn?'Only you and the people below can open it. Other admins see it locked.':'Other admins can open and change it. Turn on to keep it to yourself and the people below.'}</p></div>${toggle(!!o.privateOn,'Private','data-priv')}</div>`:'')+`<div class="ab-host"></div><p class="hint" style="margin-top:14px">To hand the agent over, choose Make owner next to a person; you keep Can edit.</p>`;
 box.querySelector('[data-priv]')?.addEventListener('change',async e=>{const on=e.target.checked;e.target.disabled=true;try{await call('/private',{on},on?ident(name).name+' is private now':ident(name).name+' is open to admins again')}catch(err){e.target.checked=!on;e.target.disabled=false;fail(err)}});
 AccessBlock.live(box.querySelector('.ab-host'),{owner:o.owner?{id:o.owner.id,name:o.owner.name,ava:personAva(o.owner,32)}:null,ownerNote:'Owner',levels:{chat:LEVEL_LABEL.chat,edit:LEVEL_LABEL.edit},
  items:(o.shared||[]).map(s=>({id:s.id,name:s.name,ava:personAva(s,32),level:s.level})),
  choices:notYet.map(x=>({id:x.id,name:x.name,sub:'@'+x.username,ava:personAva(x,22)})),search:'Add people',
  onAdd:u=>call('/share',{user:u,level:'chat'},'Shared · Can chat'),
  onLevel:(u,l)=>call('/share',{user:u,level:l},'Updated'),
  onRemove:u=>call('/share',{user:u,level:''},'No longer shared'),
  onOwner:async u=>{const who=others.find(x=>x.id===u);if(!await confirmBox('Give '+ident(name).name+' to '+who.name+'?','They become its owner. You keep Can edit.','Give it away',false))return;await call('/owner',{user:u},who.name+' owns '+ident(name).name+' now')}})}

async function mailPanel(){const box=$('#mailBox');if(!box)return;let m;try{m=await UI('/ui/mail')}catch(e){if(box.isConnected)box.innerHTML='<p class="hint">Only admins can change this.</p>';return}if(!box.isConnected)return;   // the page was drawn again meanwhile
 box.innerHTML=`<label>Send email</label><select id="mlMode"><option value="direct" ${m.mode==='direct'?'selected':''}>From the server (free, may land in spam)</option><option value="smtp" ${m.mode==='smtp'?'selected':''}>Through a mail account (reliable)</option></select>
  <label>From</label><input id="mlFrom" value="${esc(m.from)}">
  <div id="mlSmtp" ${m.mode==='smtp'?'':'hidden'}><div class="sched-row"><div><label>Server</label><input id="mlHost" value="${esc(m.host)}" placeholder="smtp.gmail.com"></div><div><label>Port</label><input id="mlPort" value="${esc(String(m.port||''))}" placeholder="587"></div></div>
   <div class="sched-row"><div><label>Username</label><input id="mlUser" value="${esc(m.user)}" autocomplete="off"></div><div><label>Password</label><input id="mlPass" type="password" placeholder="${m.hasPass?'Saved. Type to replace':'App password'}" autocomplete="new-password"></div></div>
   <p class="hint">For Gmail: turn on 2-step verification, make an app password, use smtp.gmail.com port 587.</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="primary" id="mlSave">Save</button><input id="mlTo" type="email" placeholder="Send a test to…" style="flex:1;min-width:180px"><button id="mlTest">Send test</button></div>`;
 $('#mlMode').onchange=e=>$('#mlSmtp').hidden=e.target.value!=='smtp';
 $('#mlSave').onclick=async()=>{try{await put(UI,'/ui/mail',{mode:$('#mlMode').value,from:$('#mlFrom').value,host:$('#mlHost').value,port:$('#mlPort').value,user:$('#mlUser').value,pass:$('#mlPass').value||undefined});toast('Email settings saved')}catch(e){fail(e)}};
 $('#mlTest').onclick=async()=>{const b=$('#mlTest');b.disabled=true;try{await post(UI,'/ui/mail/test',{to:$('#mlTo').value});toast('Test sent. Check the inbox and spam.')}catch(e){fail(e)}finally{b.disabled=false}}}
// Email sending lives on Settings (agreed layout, 18 Oct): sign-in codes and invites
{const settings=PAGES.settings;PAGES.settings=async(p,el)=>{const gone=pageTok(el);await settings(p,el);if(gone())return;if(S.me?.admin===false||el.querySelector('#mailBox'))return;
 const box=document.createElement('div');box.className='panel card';box.style.marginBottom='16px';box.innerHTML=`<h2>Email sending</h2><p class="sub">Used for sign-in codes and invites.</p><div id="mailBox">${skeleton(1)}</div>`;el.prepend(box);mailPanel()}}

/* ---------- per person: which models, and a daily limit ---------- */
const LIMITS=[[0,'No limit'],[50000,'50k tokens a day'],[200000,'200k tokens a day'],[1000000,'1M tokens a day'],[5000000,'5M tokens a day']];
const modelSummary=u=>!u.models?'All your models':u.models.length===1?modelLabel(u.models[0].split('|').pop()):u.models.length+' models';
/* ---------- People cards (7 Nov 2026): as plain as an Agents card. Who they are, one line of what they may do and their
   agents; the gear (or the card itself) opens one side panel with everything to change: Role, Agents, Allowed to, Models
   and Daily limit, each saved as you change it. The panel's More holds the account actions (password, suspend, remove).
   Your own card opens your profile. Owners and admins reach every agent, so their panel only says so. ---------- */
const pplShares=(d,id)=>Object.entries(d.shares||{}).filter(([,m])=>m[id]).map(([a,m])=>[a,m[id]]);
const pplRole=(d,u)=>u.roleId&&u.roleId!=='custom'?d.roles?.[u.roleId]||null:null;
const pplEff=(d,u)=>{const ro=pplRole(d,u);return ro?{caps:ro.caps||[],models:ro.models||null,limit:ro.limit||null}:{caps:u.caps||[],models:u.models||null,limit:u.limit||null}};
const pplLimit=l=>(LIMITS.find(([v])=>v===(l?.tokens||0))||[0,num(l?.tokens||0)+' tokens a day'])[1];
const pplCan=u=>!(u.role==='owner'||u.id===S.me?.id||u.role==='admin'&&S.me?.role!=='owner');   // may set their password, suspend, remove
const pplSub=u=>[u.email||'No email yet',ROLE_LABEL[u.role],u.last&&u.id!==S.me?.id?'seen '+ago(u.last/1000):''].filter(Boolean);
// a line of parts, each its own span so every part is translated on its own
const pplParts=xs=>xs.map(x=>`<span>${esc(x)}</span>`).join('<i aria-hidden="true"> · </i>');
const pplSummary=(d,u)=>{if(u.role!=='member')return [u.role==='owner'?'Everything, including people and keys':'Everything except changing the owner'];
 const e=pplEff(d,u),ro=pplRole(d,u);return [...(ro&&u.roleId!=='member'?[ro.name]:[]),e.caps.length?plural(e.caps.length,'permission'):'Chat only',modelSummary(e),pplLimit(e.limit)]};
const pplAgents=(d,u)=>{if(u.role!=='member'){const all=(Pages._agents||[]).filter(n=>!n.includes('--'));return {list:all,label:'Every agent'+(all.length?' ('+all.length+')':'')}}
 const sh=pplShares(d,u.id);return {list:sh.map(([a])=>a),label:!sh.length?'No agents shared yet':sh.length===1?ident(sh[0][0]).name:plural(sh.length,'agent'),level:sh.length===1?LEVEL_LABEL[sh[0][1]]||sh[0][1]:''}};
const pplStack=list=>list.length?`<span class="pstack">${list.slice(0,5).map(a=>agentAvatar(a,26,{title:false})).join('')}${list.length>5?`<small>+${list.length-5}</small>`:''}</span>`:'';
function pplCard(d,u,i){const self=u.id===S.me?.id,ag=pplAgents(d,u),risky=u.role==='member'&&pplEff(d,u).caps.includes('unsafe');
 return `<div class="card tile person${u.disabled?' suspended':''}" ${i==null?'':st(i)} data-act="${self?'me-profile':'ppl-open'}" data-id="${esc(u.id)}" data-q="${esc([u.name,u.username,u.email,ROLE_LABEL[u.role],pplRole(d,u)?.name].filter(Boolean).join(' ').toLowerCase())}" role="button" tabindex="0" aria-label="${esc(self?'Edit your profile':'Open '+u.name)}">
  <div class="tile-top">${personAva(u,40)}<div class="ptxt"><h3>${esc(u.name)}</h3><span class="psub"><span class="pmail">${esc(u.email||'No email yet')}</span><span class="pmeta">${pplParts(pplSub(u).slice(1))}</span></span></div></div>
  <p class="psum">${pplParts(pplSummary(d,u))}</p>
  <div class="pagents">${pplStack(ag.list)}<span class="pa-l">${esc(ag.label)}</span>${ag.level?`<small>${esc(ag.level)}</small>`:''}</div>
  ${u.disabled||risky?`<div class="agent-tags">${u.disabled?`<span class="chip">${icon('lock',12)}Suspended</span>`:''}${risky?'<span class="chip bad">Terminal and files</span>':''}</div>`:''}
  <div class="tile-foot"><span class="agent-go">${icon(self?'user':'settings',14)}<span>${self?'Edit your profile':'Edit access'}</span></span></div></div>`}

// the side panel
const ppSec=(t,body,cls='')=>`<section class="pp-sec ${cls}"><h3 class="th">${esc(t)}</h3>${body}</section>`;
function pplBody(d,u){const mem=u.role==='member',ro=mem?pplRole(d,u):null,e=mem?pplEff(d,u):null,edit=mem&&!ro,ms=Chat.models||[];
 const head=`<div class="pp-who">${personAva(u,48)}<div class="pp-id"><b>${esc(u.name)}</b><span>${pplParts(pplSub(u))}</span>${u.disabled?`<span class="p-state">${icon('lock',13)}Suspended. They can't sign in.</span>`:''}</div></div>`;
 if(!mem){const ag=pplAgents(d,u);return head+ppSec('Agents',`<div class="pp-line">${pplStack(ag.list)}<b>${esc(ag.label)}</b><span class="pval">${u.role==='owner'?'Owner':'Admin'}</span></div>`)
  +ppSec('Allowed to',`<p class="psay">${esc(pplSummary(d,u)[0])}.</p>`)+ppSec('Models and limit',`<div class="pp-line"><b>Models</b><span class="pval">All models</span></div><div class="pp-line"><b>Daily limit</b><span class="pval">No limit</span></div>`)}
 const sh=pplShares(d,u.id),caps=Object.entries(d.caps||{});
 const role=ppSec('Role',`<button type="button" class="sel-btn" data-pp="role" aria-haspopup="menu"><span class="sv">${esc(ro?ro.name:'Custom')}</span>${icon('chevD',15)}</button><p class="hint">${ro?esc(roleSummary(ro))+'. <span>From the role. Pick Custom to set their own.</span>':'<span>Their own settings below.</span>'}</p>`);
 const agents=ppSec('Agents',(sh.length?sh.map(([a,l])=>`<div class="pp-line">${agentAva(a)}<b>${esc(ident(a).name)}</b><span class="chip">${esc(LEVEL_LABEL[l]||l)}</span><button class="ghost small" data-pp="change" data-a="${esc(a)}">Change</button></div>`).join(''):'<p class="hint">No agents shared yet.</p>')
  +`<button class="ghost pp-add" data-pp="share">${icon('plus',15)}Share an agent</button>`);
 const allowed=ppSec('Allowed to',edit?caps.map(([k,l])=>`<label class="capt ${k==='unsafe'?'risky':''}"><input type="checkbox" data-ppcap="${k}" ${e.caps.includes(k)?'checked':''} ${k==='unsafe'&&S.me?.role!=='owner'?'disabled':''}><span>${esc(l)}</span></label>`).join('')
  :e.caps.length?`<ul class="pp-list">${caps.filter(([k])=>e.caps.includes(k)).map(([k,l])=>`<li class="${k==='unsafe'?'risky':''}">${icon('check',14)}<span>${esc(l)}</span></li>`).join('')}</ul>`:'<p class="psay">Chat only: they chat with the agents shared with them.</p>');
 const on=k=>!e.models||e.models.includes(k);
 const models=edit?`<label class="capt"><input type="checkbox" data-pp="allm" ${!e.models?'checked':''}><span>Every model you have on<small>New models are included automatically.</small></span></label>
  <div class="pp-mlist" ${!e.models?'hidden':''}>${[...new Set(ms.map(m=>m.providerName))].map(pv=>`<span class="pp-prov">${esc(pv)}</span>${ms.filter(m=>m.providerName===pv).map(m=>`<label class="capt"><input type="checkbox" data-ppm="${esc(m.provider+'|'+m.id)}" ${on(m.provider+'|'+m.id)?'checked':''}><span>${esc(m.label)}</span></label>`).join('')}`).join('')||'<p class="hint">No models are on yet.</p>'}</div>`
  :`<div class="pp-line"><b>Models</b><span class="pval">${esc(modelSummary(e))}</span></div>`;
 const limit=edit?`<div class="pp-line"><b>Daily limit</b><button type="button" class="sel-btn inline" data-pp="limit" aria-haspopup="menu"><span class="sv">${esc(pplLimit(e.limit))}</span>${icon('chevD',15)}</button></div>`
  :`<div class="pp-line"><b>Daily limit</b><span class="pval">${esc(pplLimit(e.limit))}</span></div>`;
 return head+role+agents+allowed+ppSec(edit?'Models':'Models and limit',models+limit)}
const pplFind=id=>{const d=Pages._ppl||{};return [d.owner,...(d.users||[])].find(x=>x?.id===id)};
// grow or shrink to the new height instead of jumping
function ppHeight(el,change){const h0=el.offsetHeight;change();const h1=el.offsetHeight;if(h0===h1||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
 el.style.overflow='hidden';el.animate([{height:h0+'px'},{height:h1+'px'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'}).onfinish=()=>{el.style.overflow=''}}
// draw the panel (and the card behind it) again from Pages._ppl; the panel keeps its place
function pplRepaint(dr){const u=pplFind(dr.dataset.id);if(!u){closeLayers();return}const box=dr.querySelector('.pp-body'),sc=dr.querySelector('.drawer-body'),y=sc?.scrollTop||0;
 ppHeight(box,()=>{box.innerHTML=pplBody(Pages._ppl,u)});if(sc)sc.scrollTop=y}
function pplCardRepaint(id){const u=pplFind(id),old=document.querySelector(`.people-grid .person[data-id="${CSS.escape(id)}"]`);if(!u||!old)return;
 const t=document.createElement('div');t.innerHTML=pplCard(Pages._ppl,u,null);const n=t.firstElementChild;n.style.animation='none';old.replaceWith(n);pplFilter()}
async function pplSave(dr,body,msg='Saved',{repaint=true}={}){const id=dr.dataset.id;try{await UI('/ui/people/'+encodeURIComponent(id),{method:'PATCH',body});toast(msg)}catch(e){fail(e);if(dr.isConnected)pplRepaint(dr);return false}
 try{Pages._ppl=await UI('/ui/people')}catch{return true}pplCardRepaint(id);if(repaint&&dr.isConnected&&!dr.classList.contains('closing'))pplRepaint(dr);return true}
// leave this panel before another one opens (one panel at a time); once that one closes, People shows what changed
const ppThen=fn=>{closeLayers();setTimeout(async()=>{await fn();const mo=new MutationObserver(()=>{if(document.querySelector('.drawer:not(.closing)'))return;mo.disconnect();if(route().page?.id==='people')reload()});
 mo.observe(document.body,{childList:true,subtree:false,attributes:true,attributeFilter:['class']})},230)};
ACT['ppl-open']=async a=>{const u=pplFind(a.dataset.id);if(!u)return;if(u.role==='member'&&!Chat.models)await Chat.loadModels().catch(()=>{});
 const dr=sideDrawer('Edit access',`<div class="pp-body">${pplBody(Pages._ppl,u)}</div>`,`${pplCan(u)?`<button class="ghost" data-menu="person" data-id="${esc(u.id)}">${icon('more',16)}More</button><span class="pp-gap"></span>`:''}<button class="primary" data-act="close">Done</button>`);
 dr.classList.add('ppl-panel');dr.dataset.id=u.id;
 dr.addEventListener('click',ev=>{const b=ev.target.closest('[data-pp]');if(!b||b.tagName==='INPUT')return;ev.stopPropagation();$$('.menu:not(.closing)').forEach(x=>leave(x,150));const w=b.dataset.pp,d=Pages._ppl,me=pplFind(dr.dataset.id);if(!me)return;
  if(w==='role')menu(b,[{header:'Role of '+me.name},...Object.entries(d.roles||{}).map(([k,ro])=>({label:ro.name,sub:roleSummary(ro),on:me.roleId===k,run:()=>me.roleId!==k&&pplSave(dr,{roleId:k},'Role changed')})),'-',
   {label:'Custom',sub:'Their own settings',on:!pplRole(d,me),run:()=>pplRole(d,me)&&pplSave(dr,{roleId:null},'Role changed')}],{matchWidth:true});
  if(w==='limit'){const cur=pplEff(d,me).limit?.tokens||0;menu(b,[{header:'Daily limit'},...LIMITS.map(([v,l])=>({label:l,on:cur===v,run:()=>cur!==v&&pplSave(dr,{limit:v?{tokens:v}:null})}))],{matchWidth:true})}
  if(w==='change'){const ag=b.dataset.a;ppThen(()=>ACT['agent-share'](ag))}
  if(w==='share'){const taken=pplShares(d,me.id).map(([a])=>a),list=(Pages._agents||[]).filter(n=>!n.includes('--')&&!taken.includes(n));
   menu(b,list.length?[{header:'Share which agent?'},...list.map(n=>({label:ident(n).name,icon:'user',ava:agentAvatar(n,20,{title:false}),run:()=>ppThen(()=>ACT['agent-share'](n,{add:me.id}))}))]:[{header:'Every agent is already shared'}],{matchWidth:true})}});
 dr.addEventListener('change',async ev=>{const x=ev.target;if(x.tagName!=='INPUT')return;const me=pplFind(dr.dataset.id);if(!me)return;const box=dr.querySelector('.pp-body');
  if(x.dataset.ppcap){if(x.dataset.ppcap==='unsafe'&&x.checked&&!await confirmBox('Give terminal and file tools?','Agents with these tools can read everything on the box, including your keys and other people\'s files. Only for people you trust like an admin.','Allow')){x.checked=false;return}
   const caps=[...box.querySelectorAll('[data-ppcap]:checked')].map(i=>i.dataset.ppcap);if(!await pplSave(dr,{caps},'Saved',{repaint:false}))x.checked=!x.checked;return}
  if(x.dataset.pp==='allm'){const list=box.querySelector('.pp-mlist'),sec=x.closest('.pp-sec');ppHeight(sec,()=>{list.hidden=x.checked});
   const picked=[...list.querySelectorAll('[data-ppm]:checked')].map(i=>i.dataset.ppm);
   if(!x.checked&&!picked.length)return;   // nothing to keep yet: they pick models below
   pplSave(dr,{models:x.checked?null:picked},'Saved',{repaint:false});return}
  if(x.dataset.ppm){const picked=[...box.querySelectorAll('[data-ppm]:checked')].map(i=>i.dataset.ppm);if(!picked.length){x.checked=true;return toast('Pick at least one model','err')}
   pplSave(dr,{models:picked},'Saved',{repaint:false})}});
 return dr};

/* ---------- System › Usage: by person (aqeelOS knows who started each chat; the engine does not), and Code. By agent and
   by model come from the engine on the page above, so each number has one source (1 Nov 2026). A member sees this part
   only, for themselves: today, their own totals and their Code runs. ---------- */
{const base=PAGES.usage;PAGES.usage=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;
 const days=+String(S.tab.usage||'7 days').split(' ')[0]||7,member=S.me?.admin===false;const who=member?'*':usageWho(await viewAgents().catch(()=>[]));if(gone())return;let d;try{d=await UI('/ui/usage?days='+days+(who!=='*'?'&agent='+encodeURIComponent(who):''))}catch{return}if(gone())return;
 const tok=o=>num((o.input||0)+(o.output||0));
 const table=(title,rows,label,sub='')=>rows.length?`<div class="panel card" style="margin-top:16px"><h2>${title}</h2>${sub?`<p class="sub">${esc(sub)}</p>`:''}<div class="utable"><div class="uh"><span>${label}</span><span>Chats</span><span>Messages</span><span>Tokens</span><span>Cache</span><span>Est. cost</span></div>
  ${rows.map(([k,o,head])=>`<div class="ur">${head}<span>${num(o.chats)}</span><span>${num(o.messages)}</span><span>${tok(o)}</span><span>${num(o.cache)}</span><span>${money(o.cost||0,{cents:true})}</span></div>`).join('')}</div></div>`:'';
 const ppl=Object.entries(d.byPerson||{}).filter(([,o])=>o).sort((a,b)=>(b[1].input+b[1].output)-(a[1].input+a[1].output)).map(([id,o])=>{const x=d.people?.[id]||{name:id};return [id,o,`<span class="uname">${personAva({id,...x},24)}${esc(id===S.me?.id?'You':x.name)}${x.limit?`<small>limit ${num(x.limit.tokens)}/day</small>`:''}</span>`]});
 const box=document.createElement('div');box.innerHTML=(d.today?`<div class="panel card" style="margin-top:16px"><h2>You today</h2><p class="sub" style="margin:0">${num(d.today.tokens)} tokens in ${num(d.today.messages)} messages${d.people?.[S.me?.id]?.limit?` of your ${num(d.people[S.me.id].limit.tokens)} a day`:''}.</p></div>`:'')
  +(d.failed?.length?alertBox(`Chats of ${esc(d.failed.map(a=>ident(a).name).join(', '))} couldn’t be read, so the tables below are incomplete.`,{style:'margin:16px 0 0'}):'')+table(member?'Your usage':'By person',ppl,'Person','Counted from the chats '+(member?'you':'each person')+' started in the last '+days+' days, so it can differ a little from the engine’s totals.')+(member&&!ppl.length?`<div class="panel card" style="margin-top:16px"><h2>Your usage</h2><p class="sub" style="margin:0">Nothing used in the last ${days} days. The chats you start show up here.</p></div>`:'');el.append(box);
 // a member: how full each AI account is, the cards from Models › AI accounts (read only); its header buttons stay this page's
 if(member){const ab=document.createElement('div');ab.innerHTML=`<h2 class="ach-cat" style="margin-top:26px">AI accounts</h2><p class="hint" style="margin:-4px 0 12px">How much of each account your agents run on is used. When one is nearly full, agents move to the next.</p><div>${skeleton(2)}</div>`;el.append(ab);
  const ha=$('.head-actions'),keep=ha?[...ha.childNodes]:[],run=PAGES.accounts(p,ab.lastElementChild);if(ha)ha.replaceChildren(...keep);placePills();
  try{await run}catch{ab.remove();return}if(gone())return;for(const x of panelsTitled(ab,/^(Priority|If an account fails|Switch automatically|Which agent uses what)/))x.remove();ab.querySelectorAll('.two').forEach(t=>{if(!t.querySelector('.panel'))t.remove()});ab.lastElementChild.querySelector('h2.ach-cat')?.remove()}
 // Code runs (desktop app and online), by person, agent and project
 let c;try{c=await UI('/ui/code/usage?days='+days)}catch{return}if(gone())return;const ctab=(title,rows,label)=>rows.length?`<div class="panel card" style="margin-top:16px"><h2>${title}</h2><div class="utable ucode"><div class="uh"><span>${label}</span><span>Runs</span><span>Tokens</span><span>Cache</span></div>${rows.map(([k,o,head])=>`<div class="ur">${head}<span>${num(o.runs)}</span><span>${tok(o)}</span><span>${num(o.cache)}</span></div>`).join('')}</div></div>`:'';
 const srt=o=>Object.entries(o||{}).sort((a,b)=>(b[1].input+b[1].output)-(a[1].input+a[1].output));
 const cp=srt(c.byPerson).map(([id,o])=>{const x=c.people?.[id]||{name:id};return [id,o,`<span class="uname">${personAva({id,...x},24)}${esc(id===S.me?.id?'You':x.name)}</span>`]});
 const ca=srt(c.byAgent).map(([a,o])=>[a,o,`<span class="uname">${a==='(no agent)'?esc('No agent'):agentAva(a)+esc(ident(a).name)}</span>`]);const cj=srt(c.byProject).map(([n,o])=>[n,o,`<span class="uname">${icon('folder',16)}${esc(n)}</span>`]);
 // admins: what agents did in projects on people's computers (the code bridge, 25 Oct 2026), newest first
 const br=(c.bridge||[]).map(x=>`<div class="ur"><span class="uname">${agentAva(x.agent)}${esc(ident(x.agent).name)}<small>${esc(x.tool.replace(/^project_/,''))} ${esc(x.what||'')}</small></span><span>${esc(x.userName||'')}<small>${esc(x.device||'')}</small></span><span>${esc(x.project||'')}</span><span${x.ok?'':' class="err-line"'}>${x.ok?esc(ago(x.time/1000)):esc('Refused: '+(x.note||''))}</span></div>`).join('');
 if(cp.length||ca.length||cj.length||br){const cb=document.createElement('div');cb.innerHTML=`<h2 class="ach-cat" style="margin-top:26px">Code</h2>`+ctab('Code by person',cp,'Person')+ctab('Code by agent',ca,'Agent')+ctab('Code by project',cj,'Project')
  +(br?`<div class="panel card" style="margin-top:16px"><h2>Agents in projects on computers</h2><p class="sub" style="margin:0 0 10px">Every file read, change and command an agent made through Code on someone's computer, newest first.</p><div class="utable ucode"><div class="uh"><span>Agent and what</span><span>From Code on</span><span>Project</span><span>When</span></div>${br}</div></div>`:'');el.append(cb)}}}

/* The MCP Duplicate window ("run the same server more than once, e.g. three AdsPower setups") went on 1 Nov 2026: every
   agent has its own AdsPower now (agent-adspower.mjs), and Connections adds an app to another agent with Add agent. */
/* ---------- Memory: MEMORY.md and USER.md are plain files the agent reads; you can edit them ---------- */
const memHome=()=>{const a=agentProfile()||'default';return (S.me?.hermes_home||'~/.hermes')+(a==='default'?'':'/profiles/'+a)};
// read the file as it is now ('' when it does not exist yet; null when it could not be read)
const memNow=async path=>{try{return (await readText(path)).text||''}catch(e){if(e?.status!==404&&!/not found|no such|does not exist/i.test(e?.message||''))throw e;return ''}};
ACT['mem-edit']=async a=>{const f=a.dataset.f,path=memHome()+'/memories/'+f;let cur='';try{cur=await memNow(path)}catch(e){return fail(e)}
 const d=drawer('Edit '+f,`<p class="hint" style="margin:0 0 8px">${f==='USER.md'?'What the agent knows about you: name, preferences, how you like answers.':'Notes the agent keeps about its work.'} It reads this at the start of every chat. Keep it short; entries are separated by a line with §.</p>
  <textarea id="memT" rows="18" style="font-size:13px;line-height:1.55">${esc(cur)}</textarea>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="memGo">Save</button>`);
 // the agent may have added notes while this was open: read again and never save over them unasked
 const ents=t=>t.split(/\n\s*§\s*\n/).map(x=>x.trim()).filter(Boolean);
 const ask=()=>new Promise(res=>{const {d:q,close}=stackPop(f+' changed','<p style="margin:0;color:var(--ink-2);line-height:1.55">The agent changed this file while you were editing. Load the new version (your edit is dropped), or add your new entries to the end of it.</p>',`<button class="ghost" data-x>Cancel</button><button class="ghost" id="mcLoad">Load the new version</button><button class="primary" id="mcAdd">Add my entries</button>`);
  q.querySelector('#mcLoad').onclick=e=>{e.stopPropagation();close();res('load')};q.querySelector('#mcAdd').onclick=e=>{e.stopPropagation();close();res('add')};q.addEventListener('cancel',()=>res(null));q.querySelectorAll('[data-x]').forEach(x=>x.addEventListener('click',()=>res(null)))});
 d.querySelector('#memGo').onclick=async()=>{const btn=d.querySelector('#memGo');btn.disabled=true;let text=$('#memT').value;
  try{const now=await memNow(path);
   if(now!==cur){const pick=await ask();if(!pick){btn.disabled=false;return}
    if(pick==='load'){cur=now;$('#memT').value=now;btn.disabled=false;return toast('Loaded the newest version')}
    const had=new Set(ents(now)),mine=ents(text).filter(x=>!new Set(ents(cur)).has(x)&&!had.has(x));
    if(!mine.length){cur=now;$('#memT').value=now;btn.disabled=false;return toast('No new entries of yours to add. Loaded the newest version.')}
    text=now.replace(/\s+$/,'')+(now.trim()?'\n§\n':'')+mine.join('\n§\n')+'\n'}
   const fd=new FormData();fd.append('path',path);fd.append('overwrite','true');fd.append('file',new Blob([text],{type:'text/markdown'}),f);
   await H('/files/upload-stream',{method:'POST',body:fd});closeLayers();toast(f+' saved');reload()}catch(e){fail(e);btn.disabled=false}}};

// the whole card opens a chat with that agent; the gear holds its settings
ACT['agent-card']=(a,e)=>{if(e.target.closest('[data-menu],button,a,select,input'))return;if((S.profile||'default')!==a.dataset.name)switchAgent(a.dataset.name);go('/chat')};

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
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const rows=[...el.querySelectorAll('[data-act="sk-open"][data-name]')];if(!rows.length)return;
 rows.forEach(r=>{const ic=r.querySelector('.ic');if(ic)ic.innerHTML=icon('wand',17)});
 const items=rows.map(r=>({id:r.dataset.name,name:r.dataset.name,desc:r.querySelector('.txt span')?.textContent||''}));
 explainFor('skill',items,()=>paintExplained(el,'skill','[data-act="sk-open"][data-name]',r=>r.dataset.name))}}

// MCP servers
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const list=Pages._mcp||[];if(!list.length||S.tab.mcp==='Catalog')return;
 const rows=[...el.querySelectorAll('.card.list .row')];rows.forEach((r,i)=>{if(list[i])r.dataset.mcp=list[i].name});
 explainFor('mcp',list.map(m=>({id:m.name,name:m.name,desc:(m.url||m.command||'')+' '+(Array.isArray(m.tools)?m.tools:[]).map(t=>t.name||t).slice(0,12).join(', ')})),()=>paintExplained(el,'mcp','.row[data-mcp]',r=>r.dataset.mcp))}}

// Plugins, grouped by what kind of thing they are
const PLUGIN_GROUPS={browser:'Browser backends',dashboard_auth:'Sign-in methods',auth:'Sign-in methods',image_gen:'Image generation',image:'Image generation',memory:'Memory',model_providers:'Model providers',providers:'Model providers',cron:'Scheduling',platforms:'Channels',messaging:'Channels',tools:'Tools',observability:'Monitoring',context:'Context'};
const pluginGroup=x=>{const m=/\/plugins\/([^/]+)\//.exec(x.path||'');const g=m?m[1]:'';return PLUGIN_GROUPS[g]||(g?pretty(g):'Other')};
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{if((S.tab.plugins||'Installed')==='Browse')return base(p,el);const gone=pageTok(el);
 setActions(`<button data-act="pl-rescan">${icon('refresh',16)}Rescan</button>`);const admin=S.me?.admin!==false;   // the server lets only admins switch plugins
 const h=await H('/dashboard/plugins/hub');if(gone())return;const list=h.plugins||[];const groups={};list.forEach(x=>(groups[pluginGroup(x)]||=[]).push(x));
 const row=(x,i)=>{const on=x.runtime_status==='enabled',v=ex('plugin',x.name);const page=plPage(x.dashboard_manifest);const slots=x.dashboard_manifest?.slots||[];
  const meta=[x.source,x.version?'v'+x.version:'',slots.length?'Adds to '+[...new Set(slots.map(s=>Plugins.slotLabel(s)))].join(', '):x.has_dashboard_manifest?'':'No page of its own'].filter(Boolean).join(' · ');
  const flags=(x.runtime_status==='inactive'?' <span class="chip warn" title="Switched on, but not loaded right now">Inactive</span>':'')+(x.auth_required?' '+signChip('',x.auth_command?'Sign in by running: '+x.auth_command:'It needs you to sign in first'):'')+(x.removed_reason?` <span class="chip bad" title="${esc(x.removed_reason)}">Removed from catalog</span>`:'');
  return `<div class="row" ${st(i)} data-pl="${esc(x.name)}"><div class="main-c"><span class="ic ${on?'blue':''}">${icon('layers',17)}</span><div class="txt"><b>${esc(v?.title||pretty(x.name))} <small class="realname">${esc(x.name)}</small>${flags}</b><span title="${esc(x.description||'')}">${esc(v?.summary||(x.description||'').slice(0,120))}</span><span class="hub-id" title="${esc(x.removed_reason?'Taken out of the catalog: '+x.removed_reason:meta)}">${esc(meta)}${x.removed_reason?' · Taken out of the catalog: '+esc(x.removed_reason):''}</span></div></div><div class="act">${toggle(on,x.name,'data-act="pl-toggle" data-name="'+esc(x.name)+'"'+(admin?'':' disabled title="Only admins turn plugins on or off"'))}<button class="ghost icon" data-menu="plugin" data-name="${esc(x.name)}" data-remove="${x.can_remove?1:''}" data-update="${x.can_update_git?1:''}" data-dash="${x.has_dashboard_manifest?1:''}" data-hidden="${x.user_hidden?1:''}" data-page="${esc(page||'')}" data-auth="${esc(x.auth_required?x.auth_command||'':'')}" aria-label="More">${icon('more',18)}</button></div></div>`};
 // plugin pages you can open: hidden ones (⋯ › Hide from menu) drop out; dashboard-only plugins are listed too
 const pages=[...list.filter(x=>plPage(x.dashboard_manifest)&&!x.user_hidden).map(x=>({name:x.name,label:x.dashboard_manifest.label||pretty(x.name),desc:x.dashboard_manifest.description||x.description,path:plPage(x.dashboard_manifest)})),...(h.orphan_dashboard_plugins||[]).filter(m=>plPage(m)).map(m=>({name:m.name,label:m.label||pretty(m.name),desc:m.description,path:plPage(m),only:true}))];
 const pageSec=pages.length?`<h2 class="ach-cat">Plugin pages <small class="hint">${pages.length}</small></h2><p class="hint" style="margin:-4px 0 10px">Pages plugins add. They open here in aqeelOS.</p><div class="card list">${pages.map((g,i)=>`<div class="row" ${st(i)}><div class="main-c"><span class="ic">${icon('layers',16)}</span><div class="txt"><b>${esc(g.label)}${g.only?' <span class="chip" title="A page with no plugin row above">Page only</span>':''}</b><span>${esc(g.desc||g.name)}</span></div></div><div class="act"><button class="ghost small" data-act="pl-page" data-name="${esc(g.name)}" data-path="${esc(g.path)}">Open${icon('chevR',14)}</button></div></div>`).join('')}</div>`:'';
 const paint=()=>{if(gone()||route().page?.id!=='plugins')return;el.innerHTML=`${tabs('plugins',['Installed','Browse'])}${admin?'':'<p class="hint" style="margin:0 0 12px">Only admins turn plugins on or off. Ask one if you need a plugin on.</p>'}${Object.entries(groups).sort((a,b)=>a[0]==='Other'?1:b[0]==='Other'?-1:a[0].localeCompare(b[0])).map(([g,xs])=>`<h2 class="ach-cat">${esc(g)} <small class="hint">${xs.length}</small></h2><div class="card list">${xs.map(row).join('')}</div>`).join('')}${pageSec}`;placePills()};
 paint();explainFor('plugin',list.map(x=>({id:x.name,name:x.name,desc:x.description||''})),paint)}}

/* ---------- Roles: define once (permissions, models, daily limit, how many agents), give each person one ---------- */
const roleSummary=ro=>{const n=(ro.caps||[]).length;return (n?n+' permission'+(n>1?'s':''):'Chat only')+(ro.models?' · '+ro.models.length+' model'+(ro.models.length>1?'s':''):'')+(ro.limit?' · '+num(ro.limit.tokens)+'/day':'')+(ro.maxAgents?' · up to '+ro.maxAgents+' agents':'')};
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
{const people=PAGES.people;PAGES.people=async(p,el)=>{const gone=pageTok(el);await people(p,el);if(gone())return;const d=Pages._ppl||{};if(!d.roles)return;
 // the roles themselves
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginTop='16px';
 panel.innerHTML=`<div class="h-row"><h2 style="margin:0">Roles</h2><button data-act="role-new">${icon('plus',15)}New role</button></div><p class="sub">What each kind of person may do, which models they get, a daily limit and how many agents they may own.</p>
  <div class="role-grid">${Object.entries(d.roles).map(([k,ro],i)=>`<button class="card role-card" ${st(i)} data-act="role-open" data-id="${esc(k)}"><b>${esc(ro.name)}</b><span>${esc(roleSummary(ro))}</span><small>${(n=>n===1?'1 person':n+' people')((d.users||[]).filter(x=>x.roleId===k).length)}</small></button>`).join('')}</div>`;
 el.querySelector('.people-grid')?.after(panel)}}

/* ---------- Channels for the whole team: which agent answers each one, and moving it ---------- */
{const base=ACT['wh-new'];ACT['wh-new']=async a=>{try{S.agentsCache=((await H('/profiles')).profiles||[]).map(x=>x.name)}catch{}return base(a)}}
// One way to show shared things (10 Nov 2026, owner: the Connections page is the clearest): every agent's channels are
// a Connections table (Channel | Belongs to | Status), one quiet line each. A channel answers as one agent, so there is
// no Who can use column. A row opens one centered panel (ChX) with Belongs to and Change, the name and description,
// Slack's quiet channels, who can send through it, and what the old ⋯ menu did, as small buttons.
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{
 // load the team list together with the page, and hold its place while it loads (no late pop-in)
 const admin=S.me?.admin!==false&&!S.chOverride;const pK=admin?UI('/ui/channels/links').catch(()=>({links:[]})):null,pD=admin?UI('/ui/channels').catch(()=>null):null,pA=admin?H('/profiles').catch(()=>({profiles:[]})):null;
 const gone=pageTok(el);await base(p,el);if(gone()||!admin)return;
 const panel=document.createElement('div');panel.className='ch-all';
 const head=`<div class="ch-cat-head"><h2>Every agent’s channels</h2><p class="sub">Each channel answers as one agent. Click one to move it, check it or change it.</p></div>`;
 panel.innerHTML=head+skeletonRows(2);
 el.querySelector('.grid-cards')?.before(panel);
 const d=await pD;if(gone()||!d){panel.remove();return}const LK=Object.fromEntries(((await pK)?.links||[]).map(l=>[l.name,l]));if(gone())return panel.remove();
 // extra connections (WhatsApp 2…) sit right under their agent's channels
 const agents=((await pA).profiles||[]).map(x=>x.name);if(gone())return panel.remove();const ord=a=>{const i=agents.indexOf(a.split('--')[0]);return i<0?1e6:i};
 d.channels.sort((x,y)=>ord(x.agent)-ord(y.agent)||(x.agent.includes('--'))-(y.agent.includes('--'))||x.agent.localeCompare(y.agent)||x.id.localeCompare(y.id));
 // the engine did not answer for some agents: say so, never "nothing connected"
 // a cold first read answers within 3 s with the agents it has; say who is still loading and fetch again by itself
 const loadNote=(d.loading||[]).length?`<p class="hint ch-loading" style="margin:0 0 10px"><span class="spinner"></span> Still reading ${esc((d.loading||[]).map(a=>ident(a.split('--')[0]).name).join(', '))}…</p>`:'';
 const failNote=(d.failed||[]).length?errLine((d.failed||[]).map(a=>ident(a.split('--')[0]).name+(a.includes('--')?' (extra number)':'')).join(', ')+'’s channels','','ch-fail'):'';
 Object.assign(ChX,{list:d.channels,LK,agents});
 panel.innerHTML=head+loadNote+failNote+(d.channels.length?`<div class="card list cn-list cn-3"><div class="cn-head" aria-hidden="true"><span>Channel</span><span>Belongs to</span><span>Status</span></div><div class="cn-rows">${d.channels.map(ChX.row).join('')}</div></div>`:failNote?'':'<p class="hint">No channel is connected yet. Set one up below and it shows here for the whole team.</p>');
 if(d.channels.some(c=>c.moving))laterReload(8000);else if((d.loading||[]).length)laterReload(4000);   // a move finishing after the engine restart: the list follows it
 if(ChX.d?.isConnected)ChX.paint()}}
const ChX={list:[],LK:{},agents:[],d:null,at:null,sh:null,
 find(ag,pf){return this.list.find(c=>c.agent===ag&&c.id===pf)},
 base:c=>c.agent.split('--')[0],
 extra(c){return this.LK[c.agent]||null},
 name(c){const lb=labelOf('channel',c.agent+'|'+c.id),l=this.extra(c);return lb?.name||(l?linkTitle(l):c.name)},
 kind:c=>c.account?.kind==='bot'?'Bot':c.account?.kind?'Personal account':'',
 // the quiet line: what it is and whose account, never a number, address or id
 quiet(c){const lb=labelOf('channel',c.agent+'|'+c.id);if(lb?.description)return lb.description;
  return [this.kind(c)||appName(c.id),c.account?.name||'',this.extra(c)?'extra number':''].filter(Boolean).join(' · ')},
 chip(c){return c.moving?`<span class="chip warn"><span class="spinner tiny"></span>Moving</span>`:c.paused?'<span class="chip"><i class="dot"></i>Paused</span>':chStateChip(c)},
 owner(c,sz=20){return c.paused?'<span class="cn-o none">Nobody (paused)</span>':cxOwner({owner:this.base(c),ownerName:ident(this.base(c)).name},sz)},
 row(c,i){const x=ChX,st_=c.moving?'Moving':c.paused?'Paused':chState(c).replace(' · link again','');
  return `<div class="row clickable cn-row" data-act="chx-open" data-from="${esc(c.agent)}" data-agent="${esc(c.agent)}" data-platform="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(x.name(c))}: belongs to ${esc(c.paused?'nobody':ident(x.base(c)).name)}, ${esc(st_)}" ${st(Math.min(i,12))}>
  <div class="main-c">${chLogo(c.id,c.name)}<div class="txt"><b>${esc(x.name(c))}</b><span>${esc(x.quiet(c))}</span></div></div>
  <div class="cn-own"><small class="cn-lbl">Belongs to</small>${x.owner(c)}</div>
  <div class="cn-st">${x.chip(c)}</div></div>`},
 open(ag,pf){const c=this.find(ag,pf);if(!c)return toast('That channel is gone. Reload the page.','err');this.at=[ag,pf];
  const d=drawer(this.name(c),`<div class="cn-p cn-in"></div>`,`<button class="primary" data-act="close">Done</button>`,{size:'md'});d.classList.add('cn-drawer');this.d=d;this.paint();
  setTimeout(()=>d.querySelector('.cn-p')?.classList.remove('cn-in'),700);
  // Slack's quiet channels and who can send through it come in behind, then the panel fills them in
  if(pf==='slack'&&!SlackQuiet.q)UI('/ui/slack-quiet').then(q=>{SlackQuiet.q=q;this.paint()}).catch(()=>{});
  UI('/ui/channels/shares').then(r=>{this.sh=r.shares||{};this.paint()}).catch(()=>{})},
 // fresh data in place (after a reload of the page); the panel closes when its channel is gone (removed or moved)
 paint(){const b=this.d?.querySelector('.cn-p');if(!b||!this.d.isConnected)return;const c=this.at&&this.find(...this.at);if(!c){closeLayers();return}
  b.innerHTML=this.body(c);const h=this.d.querySelector('.drawer-head h2');if(h)h.textContent=this.name(c)},
 body(c){const ag=c.agent,pf=c.id,base=this.base(c),bn=ident(base).name,l=this.extra(c),wa=pf==='whatsapp',a=`data-agent="${esc(ag)}" data-platform="${esc(pf)}"`;
  const acct=accountText(c.account);
  const top=`<div class="cn-top">${chLogo(pf,c.name)}<div class="cn-top-t"><span class="hint">${esc([this.kind(c),appName(pf)].filter(Boolean).join(' · '))}</span><p>${esc(acct||'Agents call it '+(l?linkId(l):pf))}</p>
   <div class="cn-top-st">${this.chip(c)}<span class="hint">${c.moving?'Moving to '+esc(ident(c.moving.to).name)+(c.moving.stage==='restart'?' after the engine restarts':''):c.updated_at&&!c.paused?'Updated '+when(c.updated_at):c.paused?'Stays linked, nobody answers it':''}</span></div>
   ${c.identity_error?`<p class="hint cn-why">${icon('alert',12)}${esc(c.identity_error)}</p>`:''}${c.note?`<p class="hint cn-note">${icon('edit',12)}${esc(c.note)}</p>`:''}</div></div>`;
  const alert=wa&&c.needs_link?`<div class="cn-alert">${alertBox('This WhatsApp was logged out. Link it again with a fresh QR code.',{act:'wa-link',label:'Link again',attrs:`data-agent="${esc(ag)}"`})}</div>`
   :c.pending&&!c.paused?`<div class="cn-alert">${alertBox('Settings changed since it connected.',{act:'ch-apply',label:'Reconnect to apply',attrs:a})}</div>`:'';
  const own=`<section class="cn-sec"><h3>Belongs to</h3><div class="cn-line">${c.paused?`<span class="ic">${icon('pause',15)}</span>`:agentAvatar(base,30,{title:false})}<span class="cn-lt"><b>${esc(c.paused?'Nobody (paused)':bn)}</b><small>${l?'An extra number of '+esc(bn)+': it answers as '+esc(bn):c.paused?'It stays linked. Pick an agent to answer it again':'This agent answers it. Its settings, login and approved people go along when it moves'}</small></span>${l||c.moving?'':`<button class="ghost small" data-act="chx-owner" aria-haspopup="menu">${icon('edit',14)}Change</button>`}</div></section>`;
  const lb=labelOf('channel',ag+'|'+pf);
  const about=`<section class="cn-sec"><h3>Name and description</h3><div class="cn-line"><span class="cn-lt"><b>${esc(this.name(c))}</b><small>${esc(lb?.description||'No description yet')}</small></span></div><button class="small cn-addag" data-act="chx-label">${icon('edit',14)}Edit name and description</button></section>`;
  const bot=pf==='slack'&&SlackQuiet.q?.bots?.find(x=>x.agent===ag),pre=bot?SlackQuiet.q.teams[bot.team]?.prefix||'':'';
  const quiet=bot?`<section class="cn-sec"><h3>Slack channels</h3><div class="cn-line"><span class="ic">${icon('chat',15)}</span><span class="cn-lt"><b>${pre?'Quiet in channels starting with '+esc(pre):'Answers in every channel it is in'}</b><small>Only in ${esc(bot.name||'this workspace')}</small></span><button class="ghost small" data-act="sq-edit" data-team="${esc(bot.team)}" data-name="${esc(bot.name||'')}">${icon('edit',14)}Change</button></div></section>`:'';
  const cur=this.sh?.[ag+'|'+pf],senders=cur?.senders||[];
  const send=l||!this.sh?'':`<section class="cn-sec"><h3>Who can send through it${senders.length?` <small class="hint">${senders.length+1} agents</small>`:''}</h3><p class="hint cn-how">${esc(bn)} gets every reply. Agents added here can also send you messages through it.</p><div class="cn-lines">
   <div class="cn-line">${agentAvatar(base,30,{title:false})}<span class="cn-lt"><b>${esc(bn)}</b><small>It belongs to this agent</small></span></div>${senders.map(s=>`<div class="cn-line">${agentAvatar(s,30,{title:false})}<span class="cn-lt"><b>${esc(ident(s).name)}</b><small>Can send through it</small></span></div>`).join('')}</div>
   <button class="small cn-addag" data-act="ch-share" data-owner="${esc(ag)}" data-platform="${esc(pf)}">${icon(senders.length?'edit':'plus',14)}${senders.length?'Change':'Add agent'}</button></section>`;
  const B=[`<button class="small" data-act="ch-check" ${a}>${icon('activity',14)}Check connection</button>`];
  if(!c.paused&&!c.moving)B.push(`<button class="small" data-act="ch-apply" ${a}>${icon('refresh',14)}Reconnect</button>`);
  if(wa)B.push(`<button class="small" data-act="wa-replace" data-agent="${esc(ag)}">${icon('refresh',14)}Link a different phone</button>`);
  if(!l&&!c.moving)B.push(c.paused?`<button class="small" data-act="chx-pause" data-on="0">${icon('play',14)}Answer it again</button>`:`<button class="small" data-act="chx-pause" data-on="1">${icon('pause',14)}Pause</button>`);
  B.push(`<button class="small" data-act="chx-note">${icon('edit',14)}${c.note?'Edit the note':'Add a note'}</button>`);
  B.push(wa?`<button class="ghost small cn-dis" data-act="wa-remove" data-agent="${esc(ag)}">${icon('trash',14)}Remove this WhatsApp</button>`:`<button class="ghost small cn-dis" data-act="ch-remove" ${a}>${icon('trash',14)}Remove this connection</button>`);
  return top+alert+own+about+quiet+send+`<section class="cn-sec cn-do"><div class="cn-btns">${B.join('')}</div></section>`}};
ACT['chx-open']=a=>ChX.open(a.dataset.agent,a.dataset.platform);
const chxCur=()=>ChX.at&&ChX.find(...ChX.at);
// Belongs to › Change: the same move as before (asked first; Nobody pauses it, with Undo in the toast)
ACT['chx-owner']=a=>{const c=chxCur();if(!c)return;const was=c.paused?'':c.agent;
 menu(a,[{header:'Which agent answers '+appName(c.id)},...ChX.agents.map(n=>({label:ident(n).name,ava:agentAvatar(n,20,{title:false}),on:n===was,run:()=>chMove(c,n)})),'-',{label:'Nobody (paused)',icon:'pause',sub:'It stays linked; nobody answers it',on:was==='',run:()=>chMove(c,'')}],{search:ChX.agents.length>6})};
async function chMove(c,to){const from=c.agent,pf=c.id,was=c.paused?'':from;if(to===was)return;
 const acct=accountText(c.account),what=appName(pf)+(acct?' ('+acct+')':'');
 // nobody: it stays linked and ready, it just isn't answered; undone from its toast, the same way everywhere (setPaused)
 if(to==='')return setPaused(from,pf,true,what);
 if(to===from){try{const r=await post(UI,'/ui/channels/pause',{agent:from,platform:pf,on:true});toast(ident(from).name+' answers '+what+' again'+(r.restarting?' (the engine restarts once)':''));reload()}catch(e){fail(e)}return}
 if(!await confirmBox('Move this channel to '+ident(to).name+'?',ident(to).name+' will answer it from now on. Its settings and approved people move along; the channel restarts for a few seconds.','Move',false))return;
 try{const r=await post(UI,'/ui/channels/move',{platform:pf,from,to});closeLayers();r?.pending==='restart'?toast('Moving after the engine restarts (replies in progress finish first). This list updates by itself.'):r?.on===false?toast('Moved, but '+ident(to).name+' couldn’t switch it on. Switch it on under Connections.','err'):toast('Moved. '+ident(to).name+' answers it now.');reload()}catch(e){fail(e)}}
ACT['chx-pause']=a=>{const c=chxCur();if(!c)return;const acct=accountText(c.account);setPaused(c.agent,c.id,a.dataset.on==='1',appName(c.id)+(acct?' ('+acct+')':''))};
ACT['chx-label']=()=>{const c=chxCur();if(!c)return;const lb=labelOf('channel',c.agent+'|'+c.id);labelEdit('channel',c.agent+'|'+c.id,{name:ChX.name(c),description:lb?.description||'',real:c.id})};
ACT['chx-note']=async()=>{const c=chxCur();if(!c)return;const v=await promptBox('Note for '+appName(c.id),'What is it for? (only you see this)',c.note||'','Save');if(v==null)return;
 try{await put(UI,'/ui/channels/note',{agent:c.agent,platform:c.id,note:v});toast(appName(c.id)+' note saved');reload()}catch(e){fail(e)}};

/* ---------- Used by / Share with other agents (skills, MCP tools, plugins, schedules) ---------- */
const SHARE_KIND_LABEL={skill:'skill',mcp:'MCP tool',plugin:'plugin',schedule:'schedule'};
async function usedByMap(kind){try{return await UI('/ui/share/used?kind='+kind)}catch{return {}}}
async function shareDrawer(kind,name,label,has=[]){let agents=[];try{agents=((await H('/profiles')).profiles||[]).map(x=>x.name)}catch(e){return fail(e)}
 const from=(agentProfile()||'default');const others=agents.filter(a=>a!==from);
 const d=drawer('Share '+label,`<p class="hint" style="margin:0 0 10px">Copies this ${SHARE_KIND_LABEL[kind]} from ${esc(ident(from).name)} to the agents you tick, with its settings. Each agent keeps its own copy, so later changes stay on the agent you change.</p>
  ${others.length?others.map(a=>`<label class="capt"><input type="checkbox" value="${esc(a)}" ${has.includes(a)?'checked disabled':''}>${agentAva(a)}<span>${esc(ident(a).name)}${has.includes(a)?' <small class="hint">already has it</small>':''}</span></label>`).join(''):'<p class="hint">There are no other agents yet.</p>'}`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="shrGo">Share</button>`);
 d.querySelector('#shrGo').onclick=async()=>{const to=[...d.querySelectorAll('input:checked:not(:disabled)')].map(i=>i.value);if(!to.length)return toast('Tick at least one agent','err');
  try{let r=await post(UI,'/ui/share',{kind,name,from,to});
   // an agent with its own copy of the skill: replace it only when the person says so
   const own=(r.failed||[]).filter(f=>f.exists).map(f=>f.agent);
   if(own.length&&await confirmBox('Replace their own copy?',own.map(a=>ident(a).name).join(', ')+(own.length===1?' has':' have')+' its own copy of '+label+' already (maybe switched off or changed). Sharing replaces it with this one.','Replace',false)){
    const r2=await post(UI,'/ui/share',{kind,name,from,to:own,replace:true});r={done:[...r.done,...r2.done],failed:[...r.failed.filter(f=>!f.exists),...r2.failed]}}
   else if(own.length)r={done:r.done,failed:r.failed.filter(f=>!f.exists)};
   closeLayers();if(!r.done.length&&!r.failed.length)return toast('Nothing shared');toast(r.failed?.length?`Shared with ${r.done.length}; ${r.failed.map(f=>ident(f.agent).name+': '+f.error).join('; ')}`:`Shared with ${r.done.map(a=>ident(a).name).join(', ')}`,r.failed?.length?'err':undefined);reload()}catch(e){fail(e)}}}
// add Used by (Access.btn, the one component; each agent keeps its own copy, so no owner) to each row; it opens Share
async function decorateRows(el,kind,rows){if(S.me?.admin===false&&kind!=='skill')return;const used=await usedByMap(kind);if(!el.isConnected)return;const here=agentProfile()||'default';
 for(const {row,name,label} of rows){const act=row.querySelector('.act');if(!act||act.querySelector('.share-box'))continue;const list=used[name]||[];
  const users=[here,...list.filter(a=>a!==here)].map(a=>({id:a,name:ident(a).name}));
  const box=document.createElement('span');box.className='share-box';box.innerHTML=Access.btn({copies:true,label:label||name,users},'type="button"');
  box.querySelector('button').onclick=e=>{e.stopPropagation();shareDrawer(kind,name,label||name,list)};act.prepend(box)}}
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const rows=[...el.querySelectorAll('[data-act="sk-open"][data-name]')].map(r=>({row:r,name:r.dataset.name,label:ex('skill',r.dataset.name)?.title||r.dataset.name}));if(rows.length)decorateRows(el,'skill',rows)}}
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const go=()=>{const rows=[...el.querySelectorAll('.row[data-pl]')].map(r=>({row:r,name:r.dataset.pl,label:ex('plugin',r.dataset.pl)?.title||r.dataset.pl}));if(rows.length)decorateRows(el,'plugin',rows)};go();setTimeout(()=>{if(!gone())go()},9000)}}
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const rows=[...el.querySelectorAll('.row[data-mcp]')].map(r=>({row:r,name:r.dataset.mcp,label:ex('mcp',r.dataset.mcp)?.title||r.dataset.mcp}));if(!rows.length)return;
 decorateRows(el,'mcp',rows);
 if(S.me?.admin!==false)rows.forEach(({row,name})=>{const act=row.querySelector('.act');const b=document.createElement('button');b.className='ghost icon';b.title='Rename';b.setAttribute('aria-label','Rename');b.innerHTML=icon('edit',16);
  b.dataset.act='mcp-rename';b.dataset.name=name;act.querySelector('[data-act="mcp-del"]')?.before(b)})}}
ACT['mcp-rename']=async a=>{const name=a.dataset.name,ag=a.dataset.agent||viewing();const v=await promptBox('Rename '+name,'New name (letters, numbers, dots or dashes)',name,'Rename');if(!v||v.trim()===name)return;
 try{await post(UI,'/ui/share/rename-mcp',{agent:ag,from:name,to:v.trim()});toast(name+' renamed to '+v.trim()+' · it reconnects on the next message');reload()}catch(er){fail(er)}};
// schedules: copy one to another agent from its ⋯ menu
{const base=Pages.cronMenu;Pages.cronMenu=el=>{const id=el.dataset.id,prof=el.dataset.profile||'default';const real=window.menu;
 window.menu=(a,items,...rest)=>{window.menu=real;return real(a,[{label:'Copy to another agent…',icon:'fork',run:()=>{const keep=S.profile;S.profile=prof==='default'?'':prof;shareDrawer('schedule',id,(Pages.cronJobs||[]).find(x=>x.id===id)?.name||'schedule').finally(()=>{S.profile=keep})}},'-',...items],...rest)};
 try{base(el)}catch(e){window.menu=real;throw e}}}

/* ---------- schedule results reach you here: a pop-up when a scheduled run finishes ---------- */
const CronNotify={
 key:()=>'cronSeen:'+(S.profile||'default'),
 async check(){if(document.hidden||!S.signedIn)return;let list=[];try{list=(await H('/sessions?sources=cron&limit=5')).sessions||[]}catch{return}
  let seen=0;try{seen=+localStorage.getItem(this.key())||0}catch{}
  const newest=Math.max(0,...list.filter(s=>!s.is_active).map(s=>s.started_at||0));if(!seen){try{localStorage.setItem(this.key(),String(newest||Date.now()/1000))}catch{}return}
  const fresh=list.filter(s=>(s.started_at||0)>seen&&!s.is_active).reverse();if(!fresh.length)return;
  try{localStorage.setItem(this.key(),String(newest))}catch{}
  for(const s of fresh){let text='';try{const m=await H('/sessions/'+encodeURIComponent(s.id)+'/messages?limit=6&order=latest');const ms=(m.messages||m||[]).filter(x=>x.role==='assistant'&&Chat.contentText(x.content).trim());text=Chat.contentText((ms[0]||ms[ms.length-1])?.content)}catch{}
   this.show(s,text)}
  this.failures()},
 // the first line or two of what it said, without Markdown marks
 gist(t){return noThink(t).replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/MEDIA:\S+/g,'').replace(/[*_#`>|]+/g,'').replace(/\s+/g,' ').trim().slice(0,170)},
 show(s,text){const name=String(s.title||'Schedule').replace(/ · [A-Z][a-z]{2} \d+ \d\d:\d\d$/,'').replace(/^\s*\[[^\]]*\]\s*/,'');
  // a run the person started with Run now reaches the bell; a schedule running on its own is Activity
  Notices.show({icon:'clock',key:'cron:'+s.id,repeat:false,started:RanNow.hit(name),title:name+' finished',text:this.gist(text)||'Done. Open it to see the result.',actions:[{label:'Open',go:'/chat/'+s.id}]})},   // the key: one item per run on every device
 // a schedule that failed, or found nowhere to deliver, says so once, in plain words, with a way to fix it
 async failures(){let jobs=[];try{jobs=await H('/cron/jobs?profile=all')}catch{return}
  for(const j of jobs){const err=j.last_delivery_error||(j.last_status&&j.last_status!=='ok'?(j.last_error||j.last_status):'');if(!err||!j.last_run_at||Date.now()-new Date(j.last_run_at)>86400e3)continue;
   const k='cronFail:'+(j.profile||'default')+'|'+j.id+'|'+j.last_run_at;try{if(localStorage.getItem(k))continue;localStorage.setItem(k,'1')}catch{continue}
   const plain=/auth|token|expired|401|403|sign.?in|credential/i.test(err)?'A sign-in it needs has expired. Ask the agent to connect it again.':/deliver|chat not found|recipient|not connected|platform/i.test(err)?'It ran, but the result could not be delivered. Check where it sends to.':String(err).slice(0,140);
   Notices.show({icon:'alert',kind:'warn',title:stripBracket(j.name)+' did not finish',text:plain,life:600000,key:k,go:'/automations/schedules',actions:[{label:'Fix',run:()=>{go('/automations/schedules');setTimeout(()=>{const x=(Pages.cronJobs||[]).find(y=>y.id===j.id);if(x)cronDetail(x)},900)}}]})}}
};
{let n=0;Poll.add(()=>{if(route().sec?.id==='automations'||++n%4===0)return CronNotify.check()},30000,4000)}

/* ---------- Access: one small badge on every row saying who can use it ---------- */
const accessChip=(text,tip,kind='')=>`<span class="chip access ${kind}" title="${esc(tip)}">${icon(kind==='shared'?'user':kind==='public'?'globe':'lock',11)}${esc(text)}</span>`;
// schedules: each runs on exactly one agent
{const base=PAGES.schedules;PAGES.schedules=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;el.querySelectorAll('[data-menu="cron"][data-profile]').forEach(m=>{const row=m.closest('.row,.card');const t=row?.querySelector('.txt b,h3');if(!t||t.querySelector('.access'))return;
 t.insertAdjacentHTML('beforeend',' '+accessChip('Only '+ident(m.dataset.profile).name,'Runs on '+ident(m.dataset.profile).name+'. Use Copy to another agent to reuse it.'))})}}
// webhooks: the address is public (anyone with it and the secret can send), one agent handles each
{const base=PAGES.webhooks;PAGES.webhooks=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;el.querySelectorAll('[data-act="wh-del"][data-name]').forEach(b=>{const row=b.closest('.row');const t=row?.querySelector('.txt b');if(!t||t.querySelector('.access'))return;
 t.insertAdjacentHTML('beforeend',' '+accessChip('Public address · runs on '+ident((agentProfile()||'default')).name,'Any service with the address and its secret can send events. '+ident((agentProfile()||'default')).name+' handles them.','public'))})}}
// channels: one agent answers each connection
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;el.querySelectorAll('[data-act="ch-open"][data-id]').forEach(c=>{const st=c.querySelector('.tile-foot .chip');if(!st||/Not set up/i.test(st.textContent)||c.querySelector('.access'))return;
 const id=c.dataset.id;const shared=id==='api_server'||id==='webhook';c.querySelector('h3')?.insertAdjacentHTML('beforeend',' '+(shared?accessChip('Every agent','The same address serves all agents; each request names its agent.','shared'):accessChip('Only '+ident(S.profile||'default').name,'This connection belongs to '+ident(S.profile||'default').name+'. Move it from "Every agent\'s channels" to give it to another agent.')))})}}

/* ---------- Telegram: set up with Telegram's own @BotFather (no outside pairing service) ---------- */
{const base=ACT['onboard'];ACT['onboard']=async a=>{if(a.dataset.id!=='telegram')return base(a);const box=$('#onboard');if(!box)return base(a);
 const bf='https://t.me/BotFather';
 box.innerHTML=`<div style="margin-top:12px"><img src="/ui/qr?d=${encodeURIComponent(bf)}" alt="QR code" style="width:170px;height:170px;display:block;margin:0 auto 10px;border-radius:12px;background:#fff;padding:8px">
  <ol class="qr-steps"><li>Open <a href="${bf}" target="_blank" rel="noopener">@BotFather</a> in Telegram (scan this code with your phone, or tap the link).</li><li>Send <b>/newbot</b>, give it a name (e.g. <i>aqeelOS</i>) and a username ending in <i>bot</i>.</li><li>BotFather replies with a token like <code>123456789:AA…</code>. Copy it.</li><li>Paste it below in <b>Telegram bot token</b>, switch the channel on, and press <b>Save</b>. Then message your bot.</li></ol>
  <p class="hint">Only people you approve under Channels › Who can message can talk to it.</p></div>`;
 a.hidden=true;document.querySelector('.drawer [data-env="TELEGRAM_BOT_TOKEN"]')?.focus()}}

/* ---------- Models › Mixture of agents: several models advise, one writes the answer ---------- */
async function moaPanel(el,gone=pageTok(el)){let c;try{c=await H('/config')}catch{return}const moa=c.moa||{};const presets=moa.presets||{};if(!Chat.models)await Chat.loadModels().catch(()=>{});if(gone())return;   // drawn again meanwhile: that drawing adds its own
 // a saved model whose provider is not signed in shows as the same model through a sign-in you do have (moa-map.js);
 // only one with no equivalent says "not signed in", with the sign-in it needs
 const ms=moaModels(),parts=pr=>[...(pr.reference_models||[]),pr.aggregator].filter(s=>s?.model).map(s=>moaEquivalent(s,ms));
 const usable=pr=>!parts(pr).some(r=>r.missing),stale=pr=>parts(pr).some(r=>r.changed);
 const label=s=>{if(!s?.model)return '—';const r=moaEquivalent(s,ms);return modelLabel(r.model)+(r.missing?' (not signed in: needs '+moaNeeds(s.provider)+')':'')};
 const box=document.createElement('div');box.className='panel card';box.style.marginTop='16px';
 box.innerHTML=`<div class="h-row"><h2 style="margin:0">Team of models</h2><button data-act="moa-new">${icon('plus',15)}New team</button></div><p class="sub">A team answers one question together: each advisor thinks about it, then one model writes the final answer. It is slower and uses several times as much as one model, so keep it for hard questions. To use a team, pick it as the model in a chat. Every call still goes through your accounts in priority order.</p>
  ${Object.entries(presets).map(([n,pr])=>`<div class="row moa-row" style="padding:12px 12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="main-c"><span class="ic ${usable(pr)?'blue':''}">${icon('layers',17)}</span><div class="txt"><b>${esc(pretty(n))}${moa.default_preset===n?'<span class="chip" title="Used when a chat picks Team of models without naming a team">Default</span>':''}${usable(pr)?'':accessChip('Needs another sign-in','None of your sign-ins offers '+[...new Set([...(pr.reference_models||[]),pr.aggregator].filter(s=>s?.model&&moaEquivalent(s,ms).missing).map(s=>modelLabel(s.model)+' (needs '+moaNeeds(s.provider)+')'))].join(', '),'public')}</b><span>Advisors: ${esc((pr.reference_models||[]).filter(s=>s.enabled!==false).map(label).join(', ')||'none')} · Answer: ${esc(label(pr.aggregator))}</span></div></div>
   <div class="act">${stale(pr)?`<button class="ghost" data-act="moa-fix" data-n="${esc(n)}" title="This team is saved with a provider you are not signed in to. Your own sign-ins offer the same models.">${icon('refresh',15)}Use my signed-in models</button>`:''}<button class="ghost" data-act="moa-edit" data-n="${esc(n)}">Edit</button></div></div>`).join('')||'<p class="hint">No teams yet.</p>'}`;
 el.append(box);Pages._moa={c,presets}}
// signed in and working only (owner: models you don't have, 6 Nov 2026); which sign-in a model that is not there needs
const moaModels=()=>(Chat.models||[]).filter(m=>m.provider!=='moa'&&!Chat.provWarn?.[m.provider]);
const moaNeeds=slug=>{const s=String(slug||'');return /claude-subscription/.test(s)?'a Claude subscription':s==='anthropic'?'an Anthropic API key':s==='openai-codex'?'a ChatGPT sign-in':s?provLabel({slug:s,name:pretty(s)}):'a model sign-in'};
// One button on the team row: the whole team onto the models you are signed in to, now
ACT['moa-fix']=async a=>{const n=a.dataset.n;a.disabled=true;try{if(!Chat.models)await Chat.loadModels();const cfg=await H('/config'),pr=cfg.moa?.presets?.[n];if(!pr)throw new Error('That team is gone. Reload the page.');
  const r=moaFixTeam(pr,moaModels());if(!r.changed){toast('Nothing to change: this team already uses your signed-in models');return reload()}
  cfg.moa.presets[n]=r.preset;await put(H,'/config',{config:cfg});toast(pretty(n)+' now uses your signed-in models'+(r.missing?'. '+plural(r.missing,'model')+' still '+(r.missing===1?'needs':'need')+' another sign-in.':''));Chat.models=null;await Chat.loadModels().catch(()=>{});reload()}catch(e){a.disabled=false;fail(e)}};
// A team's advisors are an ordered list: one advisor is enough, the same model may sit in it twice, and an advisor
// can be switched off without losing it. A new team starts as a copy of the default team.
async function moaDrawer(name){const {c,presets}=Pages._moa||{};const moa=c?.moa||{};const names=Object.keys(presets||{});
 const def=moa.default_preset&&presets[moa.default_preset]?moa.default_preset:names[0];
 const pr=name?presets[name]:def?JSON.parse(JSON.stringify(presets[def])):{reference_models:[],aggregator:null};
 const ms=moaModels();
 // PAR-37 (11 Nov 2026): these two sat behind the comment above, so New team / Edit for a team of models threw at once
 const key=m=>m.provider+'|'+m.id;const split=v=>{const i=v.indexOf('|');return {provider:v.slice(0,i),model:v.slice(i+1)}};
 // the app's own searchable picker for every model here (no browser dropdowns): a button that holds its value in data-v.
 // A saved model whose provider is not signed in starts on its signed-in equivalent, so Save stores the corrected one.
 const said=v=>{const m=ms.find(x=>key(x)===v);if(m)return m.label+' · '+m.providerName;const s=v?split(v):null;return s?.model?modelLabel(s.model)+' (not signed in: needs '+moaNeeds(s.provider)+')':'Choose a model…'};
 const pick=(s,attr,what)=>{const r=s?.model?moaEquivalent(s,ms):null,v=r?r.provider+'|'+r.model:'';return `<button type="button" class="sel-btn" data-mpick ${attr} data-v="${esc(v)}" aria-haspopup="listbox" aria-label="${what}"><span class="sv">${esc(said(v))}</span>${icon('chevD',15)}</button>`};
 const slot=s=>{const {provider,model,enabled,...rest}=s||{};return `<div class="moa-slot" data-extra="${esc(JSON.stringify(rest))}">${pick(s,'data-slot','Advisor model')}${toggle(enabled!==false,'Use this advisor','data-son')}<span class="moa-btns"><button type="button" class="ghost icon-btn" data-mv="-1" aria-label="Move up">${icon('chevU',16)}</button><button type="button" class="ghost icon-btn" data-mv="1" aria-label="Move down">${icon('chevD',16)}</button><button type="button" class="ghost icon-btn" data-rm aria-label="Remove advisor">${icon('x',16)}</button></span></div>`};
 const refs0=(pr.reference_models||[]).length?pr.reference_models:[ms[0]?{provider:ms[0].provider,model:ms[0].id}:null];
 const isDef=name&&moa.default_preset===name;
 const d=drawer(name?'Team · '+pretty(name):'New team',`<label>Name</label><input id="moN" value="${esc(name||'')}" placeholder="claude-team">${!name&&def?`<p class="hint" style="margin:4px 0 0">Starts as a copy of ${esc(pretty(def))}. Change what you like.</p>`:''}
  <label>Advisors</label><p class="hint" style="margin:-2px 0 8px">Each one thinks about the question, in this order.</p><div class="moa-slots" id="moS">${refs0.map(slot).join('')}</div><button type="button" class="ghost small" id="moAdd" style="margin-top:6px">${icon('plus',14)}Add advisor</button>
  <label>Writes the final answer</label>${pick(pr.aggregator,'id="moA"','Model that writes the final answer')}
  <p class="hint">More advisors give better answers, but replies are slower and use more. Switch one off to skip it for now.</p>
  ${name?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">${isDef?'':`<button class="ghost" id="moDef">${icon('check',15)}Make default</button>`}<button class="ghost" id="moDel" style="color:var(--bad)">${icon('trash',15)}Delete team</button></div>${isDef?'<p class="hint" style="margin:6px 0 0">This is the default team.</p>':''}`:''}`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="moGo">Save</button>`);
 const list=d.querySelector('#moS');
 // the model list: searchable, grouped by sign-in, the same for every advisor and for the answer model
 d.addEventListener('click',e=>{const b=e.target.closest('[data-mpick]');if(!b)return;e.stopPropagation();const items=[];let grp=null;
  for(const m of ms){if(m.provider!==grp){grp=m.provider;items.push({header:m.providerName})}items.push({label:m.label,find:m.id+' '+m.providerName,on:key(m)===b.dataset.v,run:()=>{b.dataset.v=key(m);b.querySelector('.sv').textContent=said(key(m))}})}
  if(!items.length)items.push({header:'No signed-in models. Add an account under Models first.'});
  b.classList.add('open');menu(b,items,{search:true,matchWidth:true,onClose:()=>{b.classList.remove('open');b.focus()}})});
 d.addEventListener('keydown',e=>{const b=e.target.closest?.('[data-mpick]');if(b&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();b.click()}});
 list.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.hasAttribute('data-mpick'))return;const row=b.closest('.moa-slot');
  if(b.dataset.mv){const to=b.dataset.mv==='-1'?row.previousElementSibling:row.nextElementSibling?.nextElementSibling;if(b.dataset.mv==='-1'&&!to)return;list.insertBefore(row,to||null);row.classList.remove('moa-in');void row.offsetWidth;row.classList.add('moa-in')}
  else if(b.hasAttribute('data-rm')){if(list.children.length<2)return toast('A team needs at least one advisor','err');leave(row,180)}});
 d.querySelector('#moAdd').onclick=()=>{const last=list.lastElementChild?.querySelector('[data-slot]')?.dataset.v;const t=document.createElement('div');t.innerHTML=slot(last?split(last):null);const row=t.firstElementChild;row.classList.add('moa-in');list.append(row)};
 const write=async fn=>{const cfg=await H('/config');cfg.moa=cfg.moa||{};cfg.moa.presets=cfg.moa.presets||{};fn(cfg.moa);await put(H,'/config',{config:cfg})};
 d.querySelector('#moGo').onclick=async()=>{const n=(name||$('#moN').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,''));   // a new team's name; an existing one may be renamed below
  if(!n)return toast('Give the team a name','err');
  if(!name&&presets[n])return toast('A team with that name exists. Pick another name.','err');
  const refs=[...list.querySelectorAll('.moa-slot:not(.closing)')].map(r=>{let x={};try{x=JSON.parse(r.dataset.extra||'{}')}catch{}return {...x,...split(r.querySelector('[data-slot]').dataset.v||'|'),enabled:r.querySelector('[data-son]').checked}}).filter(s=>s.model);
  if(!refs.some(s=>s.enabled))return toast('Switch on at least one advisor','err');
  const agg=split(d.querySelector('#moA').dataset.v||'|');if(!agg.model)return toast('Choose the model that writes the final answer','err');
  const newName=name?($('#moN').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'')||name):n;
  if(name&&newName!==name&&presets[newName])return toast('A team with that name exists. Pick another name.','err');
  try{await write(m=>{const prev=m.presets[name||n]||(name?{}:pr);if(name&&newName!==name){delete m.presets[name];if(m.default_preset===name)m.default_preset=newName;if(m.active_preset===name)m.active_preset=newName}
    m.presets[newName]={...prev,reference_models:refs,aggregator:{...(prev.aggregator||{}),...agg},enabled:true};if(!m.default_preset)m.default_preset=newName});closeLayers();toast(name&&newName!==name?'Team renamed and saved':'Team saved. Pick it as the model in chat.');Chat.models=null;await Chat.loadModels().catch(()=>{});reload()}catch(e){fail(e)}};
 d.querySelector('#moDef')?.addEventListener('click',async()=>{try{await write(m=>{m.default_preset=name});closeLayers();toast(pretty(name)+' is now the default team');reload()}catch(e){fail(e)}});
 // the default and the active team never point at a team that is gone
 d.querySelector('#moDel')?.addEventListener('click',async()=>{if(!await confirmBox('Delete '+pretty(name)+'?',names.length<2?'It is your last team. Chats using it switch back to a normal model; New team makes another.':'Chats using it switch back to a normal model.','Delete'))return;try{await write(m=>{delete m.presets[name];const first=Object.keys(m.presets)[0]||'';if(m.default_preset===name)m.default_preset=first;if(m.active_preset===name)m.active_preset=first});closeLayers();toast('Team deleted');reload()}catch(e){fail(e)}})}
ACT['moa-new']=()=>moaDrawer(null);ACT['moa-edit']=a=>moaDrawer(a.dataset.n);
{const base=PAGES.models;PAGES.models=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if(S.me?.admin===false)return;moaPanel(el,gone)}}

/* ---------- channel states in plain words, and relinking WhatsApp ---------- */
const CH_STATE={connected:'Connected',pending_restart:'Restart needed',retrying:'Reconnecting',starting:'Starting',connecting:'Connecting',disabled:'Off',failed:'Not connected',error:'Not connected',stopped:'Off'};
const chState=c=>c.state==='connected'?'Connected':c.needs_link||/logged out|died|exit code|bridge_exited/i.test((c.error_code||'')+' '+(c.error_message||'')+' '+(c.error||''))?'Logged out · link again':CH_STATE[c.state]||pretty(c.state||'Not set up');
// the dot's colour for a channel state: on; off on purpose (paused, switched off); on its way (restart needed, connecting,
// reconnecting); broken (logged out, failed)
const chTone=c=>c.state==='connected'?'ok':c.paused||['disabled','stopped'].includes(c.state)||c.enabled===false?'':/^(Logged out|Not connected)/.test(chState(c))?'bad':['pending_restart','retrying','starting','connecting'].includes(c.state)?'warn':'';
const chDot=c=>`<i class="dot${chTone(c)?' '+chTone(c):''}"></i>`;
const chStateChip=c=>chipState(c.state==='connected','Connected',esc(c.paused?'Paused':c.enabled===false&&c.state!=='connected'?'Off':chState(c).replace(' · link again','')),chTone(c));
const APP_NAME={whatsapp:'WhatsApp',telegram:'Telegram',discord:'Discord',slack:'Slack',signal:'Signal',email:'Email',sms:'SMS',matrix:'Matrix',mattermost:'Mattermost',api_server:'API server',webhook:'Webhooks'};
const appName=p=>APP_NAME[p]||pretty(p);

/* ---------- Link WhatsApp: the one way to connect, relink or add a WhatsApp, from every button ----------
   Clears an ended login (kept aside on the box), shows a fresh QR, and once the phone scans it switches the
   channel on. Extra agents pick it up live; the main agent's engine restarts after replies in progress finish. */
async function linkWhatsApp(agent,{replace=false,title}={}){const q='?profile='+encodeURIComponent(agent);let pid=null,done=false,kept=null,tick=null,mode='bot',saved=null,scanned=false;
 const d=sideDrawer(title||'Link WhatsApp · '+ident(agent.split('--')[0]).name,`<div class="wa-opts" id="waOpts"><label>How it is used</label><div class="seg-mini wa-mode" role="radiogroup" aria-label="How it is used"><button type="button" role="radio" data-wamode="bot" class="on" aria-checked="true">A number for the agent</button><button type="button" role="radio" data-wamode="self-chat" aria-checked="false">My own number</button></div><p class="hint" id="waModeHint"></p>
  <label for="waAllow">Allowed numbers (optional)</label><input id="waAllow" inputmode="tel" autocomplete="off" placeholder="6281234567890, 6289876543210"><p class="hint" id="waAllowHint"></p></div><div id="waBox" class="wa-link"><p class="hint"><span class="spinner"></span> Getting a fresh QR code…</p></div>`,`<button class="ghost" data-act="close">Close</button>`);
 const box=d.querySelector('#waBox'),opts=d.querySelector('#waOpts'),allow=d.querySelector('#waAllow');const live=()=>box.isConnected;
 // how it is used: a number just for the agent, or your own WhatsApp (you talk to it in "Message yourself")
 const paintOpts=()=>{d.querySelectorAll('[data-wamode]').forEach(b=>{const on=b.dataset.wamode===mode;b.classList.toggle('on',on);b.setAttribute('aria-checked',on)});
  d.querySelector('#waModeHint').textContent=mode==='self-chat'?'Link your own WhatsApp and talk to the agent in your “Message yourself” chat.':'People message this WhatsApp number and the agent answers. Best with a spare number.';
  const has=!!allow.value.trim(),keep=saved?.allowed_users_set;d.querySelector('#waAllowHint').textContent=has?'These numbers can talk to it at once; anyone else asks first.':keep?'Leave empty to keep the numbers already allowed.':mode==='self-chat'?'Leave empty: your own number is allowed by itself.':'Leave empty: new people ask first, and you approve them under Channels › Who can message.'};
 d.querySelectorAll('[data-wamode]').forEach(b=>b.onclick=()=>{mode=b.dataset.wamode;paintOpts()});allow.oninput=paintOpts;paintOpts();
 H('/messaging/platforms'+q).then(r=>{saved=(r.platforms||[]).find(x=>x.id==='whatsapp')?.whatsapp_setup||null;if(/self/i.test(saved?.mode||''))mode='self-chat';if(live())paintOpts()}).catch(()=>{});
 const cleanup=()=>{clearInterval(tick);if(done)return;const c=pid?del(H,'/messaging/whatsapp/onboarding/'+encodeURIComponent(pid)+q).catch(()=>{}):Promise.resolve();pid=null;
  // once a phone was scanned its login is already written: force sets that one aside and puts the old login back
  if(kept){const k=kept;kept=null;c.then(()=>post(UI,'/ui/channels/whatsapp/restore',{agent,kept:k,force:scanned})).catch(()=>{})}};
 new MutationObserver((m,o)=>{if(!d.isConnected){o.disconnect();cleanup()}}).observe(document.body,{childList:true,subtree:true});
 const fail_=(msg,retry=true)=>{clearInterval(tick);box.innerHTML=alertBox(esc(msg),{act:'',id:retry?'waRetry':''});box.querySelector('#waRetry')?.addEventListener('click',()=>{closeLayers();linkWhatsApp(agent,{replace,title})})};
 // the whole setup has a time limit: count it down under the code
 const countdown=s=>{const at=Date.parse(s.expires_at||'');if(!isFinite(at))return;clearInterval(tick);const paint=()=>{const e=box.querySelector('#waExp');if(!e)return;const left=Math.max(0,Math.round((at-Date.now())/1000));e.textContent=left?'This code works for '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')+' more':'This code has expired';e.classList.toggle('bad',!left)};paint();tick=setInterval(paint,1000)};
 const digits=x=>String(x||'').replace(/\D/g,'');
 try{kept=(await post(UI,'/ui/channels/whatsapp/prepare',{agent,replace}))?.kept||null;
  const start=await post(H,'/messaging/whatsapp/onboarding/start'+q,{mode});pid=start.pairing_id||start.id;
  let s=start,lastQr='',miss=0;
  for(let i=0;i<150&&live();i++){
   if(s.status==='connected'){clearInterval(tick);scanned=true;const phone=s.account_phone?'+'+digits(s.account_phone):'';
    // look before switching on: the linked account, then Switch it on or Cancel
    box.innerHTML=`<div class="wa-done"><span class="ic ok">${icon('check',22)}</span><div><b>Linked${phone?' as '+esc(phone):''}${s.account_name?' ('+esc(s.account_name)+')':''}</b><p class="hint" style="margin:4px 0 10px">Check how it is used above, then switch it on.</p><div class="wa-acts"><button class="primary" id="waApply">${icon('power',15)}Switch it on</button><button class="ghost" id="waCancel">Cancel</button></div></div></div>`;
    const go=await new Promise(res=>{box.querySelector('#waApply').onclick=()=>res(true);box.querySelector('#waCancel').onclick=()=>res(false)});if(!live())return;
    if(!go){cleanup();box.innerHTML=`<p class="hint">Cancelled. Nothing was changed.</p><button class="primary" id="waRetry">${icon('refresh',15)}Start again</button>`;box.querySelector('#waRetry').onclick=()=>{closeLayers();linkWhatsApp(agent,{replace,title})};return}
    const ab=box.querySelector('#waApply');ab.disabled=true;box.querySelector('#waCancel').disabled=true;
    let au=(allow.value.match(/\+?\d[\d\s-]{5,}\d/g)||[]).map(digits).filter(Boolean);if(!au.length&&mode==='self-chat'&&!saved?.allowed_users_set&&s.account_phone)au=[digits(s.account_phone)];
    let r;try{r=await post(H,'/messaging/whatsapp/onboarding/'+encodeURIComponent(pid)+'/apply'+q,{mode,...(au.length?{allowed_users:[...new Set(au)].join(',')}:{})})}catch(e){cleanup();return fail_(e.message||String(e))}
    done=true;leave(opts,210);const ph=r.account?.phone||phone,self=mode==='self-chat';
    box.innerHTML=`<div class="wa-done"><span class="ic ok">${icon('check',22)}</span><div><b>WhatsApp linked${ph?' · '+esc(ph):''}</b><p class="hint" style="margin:4px 0 0">${r.hot_served?'It is answering now.':r.waiting?'It starts answering as soon as the '+(r.waiting===1?'reply':r.waiting+' replies')+' in progress finish (the engine restarts once).':'The engine restarts once (about 20 seconds), then it answers.'} ${self?'Open “Message yourself” in WhatsApp on that phone and send the agent a message.':'Send it a message from another phone to try it.'}</p>${ph?`<p style="margin:8px 0 0"><a href="https://wa.me/${digits(ph)}" target="_blank" rel="noopener">${icon('chat',14)} ${self?'Open “Message yourself”':'Open chat'}</a></p>`:''}<p class="hint wa-rs" id="waRs" hidden></p></div></div>`;
    const fb=d.querySelector('.drawer-foot [data-act="close"]');if(fb){fb.textContent='Done';fb.classList.replace('ghost','primary')}d.addEventListener('click',e=>{if(e.target.closest('[data-act="close"]'))laterReload(300)});
    if(r.restarting&&!r.waiting)waWatchRestart(box);return}
   if(/error|expired|cancel/.test(s.status||'')){cleanup();return fail_(/expired/.test(s.status)?'The QR code expired before it was scanned.':'WhatsApp could not start the link: '+(s.error||s.status))}
   if(s.qr_payload&&s.qr_payload!==lastQr){lastQr=s.qr_payload;box.innerHTML=`<img class="wa-qr" src="/ui/qr?d=${encodeURIComponent(s.qr_payload)}" alt="QR code to scan with WhatsApp">
    <ol class="qr-steps"><li>Open WhatsApp on the phone this agent should use.</li><li>Tap <b>Settings</b> (iPhone) or <b>⋮</b> (Android), then <b>Linked devices</b>.</li><li>Tap <b>Link a device</b> and point the camera at this code.</li></ol><p class="hint">The code refreshes by itself; keep this window open until it says linked.</p><p class="hint wa-exp" id="waExp"></p><p class="hint" id="waNet" hidden></p>`;countdown(s)}
   else if(!s.qr_payload)box.innerHTML='<p class="hint"><span class="spinner"></span> '+(s.status==='installing'?'Preparing WhatsApp on the box…':'Getting a fresh QR code…')+'</p>';
   await new Promise(r=>setTimeout(r,2000));if(!live())break;
   // a status check that fails once (a network blip) is retried; only an expired setup or many failures in a row end it
   try{s=await H('/messaging/whatsapp/onboarding/'+encodeURIComponent(pid)+q);miss=0;const n=box.querySelector('#waNet');if(n)n.hidden=true}
   catch(e){const exp=Date.parse(s.expires_at||'');if(++miss>=6||(isFinite(exp)&&Date.now()>=exp))throw e;const n=box.querySelector('#waNet');if(n){n.hidden=false;n.textContent='The connection dropped for a moment. Still waiting…'}}}
  cleanup();if(live())fail_('This took too long. Start again for a new code.')}
 catch(e){cleanup();if(e.message&&/connected/i.test(e.message)&&!replace)return fail_(e.message,false);fail_(e.message||String(e))}}
// after linking restarts the engine: confirm it came back, or say so with a Restart now button
async function waWatchRestart(box){const out=box.querySelector('#waRs');if(!out)return;out.hidden=false;out.innerHTML='<span class="spinner"></span> Waiting for the engine to come back…';await sleep(15000);
 for(let i=0;i<35&&out.isConnected;i++){try{const s=await H('/status',{fresh:true});if(s.gateway_running){out.innerHTML=icon('check',14)+' The engine is back. WhatsApp is connecting.';return}}catch{}await sleep(3000)}
 if(out.isConnected)out.innerHTML=`<span class="err-line">The link is saved, but the engine did not come back by itself.</span> <button class="small" data-act="gw-restart">${icon('refresh',14)}Restart now</button>`}
ACT['wa-link']=a=>linkWhatsApp(a.dataset.agent||agentProfile()||'default');
ACT['wa-replace']=async a=>{const ag=a.dataset.agent||agentProfile()||'default';if(!await confirmBox('Link a different phone?','The phone linked now stops answering for '+ident(ag.split('--')[0]).name+'. Chats and approved people stay.','Link a different phone',false))return;linkWhatsApp(ag,{replace:true})};
// an engine word left on a chip ("Pending restart") in plain words; only its text changes, so its dot stays
const chWord=ch=>{const t=ch.textContent.trim();const k=Object.keys(CH_STATE).find(k=>pretty(k)===t);if(!k||CH_STATE[k]===t)return;const n=[...ch.childNodes].reverse().find(x=>x.nodeType===3);if(n)n.textContent=CH_STATE[k]};
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;
 el.querySelectorAll('.chip').forEach(chWord)}}
{const base=ACT['ch-open'];ACT['ch-open']=async a=>{await base(a);const id=a.dataset.id;const d=$('.drawer');if(!d)return;
 d.querySelectorAll('.chip').forEach(chWord);
 const c=(Pages.platforms||[]).find(x=>x.id===id);
 if(c?.account)d.querySelector('.logo-lg')?.nextElementSibling?.querySelector('b')?.insertAdjacentHTML('afterend','<div class="hint" style="margin:2px 0 0">'+esc(accountText(c.account))+'</div>');
 if(id!=='whatsapp')return;const err=d.querySelector('.err-line:not(.ch-err)');const g=d.querySelector('[data-act="onboard"]');const ag=agentProfile()||'default';
 if(err&&/bound by|bridge_conflict|already in use|port \d+/i.test(err.textContent))err.textContent='WhatsApp is starting up after a restart. The link is saved; give it a minute, then refresh.';
 else if(err&&(c?.needs_link||/logged out|died|exit|unlinked/i.test(err.textContent)))err.textContent='This WhatsApp was logged out: the device was removed under Linked devices on the phone, or WhatsApp ended the link. Link it again with a fresh QR code.';
 if(!g)return;g.dataset.agent=ag;
 if(c?.state==='connected'){g.dataset.act='wa-replace';g.innerHTML=icon('refresh',15)+'Link a different phone';g.closest('.panel')?.querySelector('.hint')?.replaceChildren(document.createTextNode('Linked'+(c.account?' as '+accountText(c.account):'')+'. Use this only to switch to another phone.'))}
 else{g.dataset.act='wa-link';g.innerHTML=icon(c?.needs_link?'refresh':'play',15)+(c?.needs_link?'Link again (fresh QR)':'Link WhatsApp (QR code)')}}}
{const base=ACT['onboard'];ACT['onboard']=a=>a.dataset.id==='whatsapp'?linkWhatsApp(agentProfile()||'default'):base(a)}

/* ---------- Skills: a readable preview (engine wording shown as aqeelOS); the source stays exactly as it is ---------- */
{const base=Pages.openSkill;Pages.openSkill=async name=>{await base(name);if(!name)return;const d=$('.drawer');const ta=d?.querySelector('#skBody');if(!ta)return;
 const lab=ta.previousElementSibling;const src=ta.value.replace(/^---[\s\S]*?\n---\n?/,'');
 const pv=document.createElement('div');pv.className='skill-preview md';pv.innerHTML=md(src);
 const bar=document.createElement('div');bar.className='h-row';bar.style.margin='4px 0 8px';bar.innerHTML=`<span class="th">What this skill tells the agent</span><button class="ghost" id="skSrc">${icon('edit',15)}Edit source</button>`;
 lab.before(bar);lab.before(pv);lab.hidden=true;ta.hidden=true;
 bar.querySelector('#skSrc').onclick=()=>{const show=ta.hidden;ta.hidden=!show;lab.hidden=!show;pv.hidden=show;bar.querySelector('#skSrc').innerHTML=show?icon('eye',15)+'Show preview':icon('edit',15)+'Edit source';if(show)ta.focus()}}}
// technical names: shown with aqeelOS, the exact name stays in the hover (it is what commands use)
{const paint=paintExplained;paintExplained=(el,kind,sel,idOf)=>{paint(el,kind,sel,idOf);el.querySelectorAll(sel+' .realname').forEach(s=>{if(s.dataset.br||!/hermes/i.test(s.textContent))return;s.dataset.br='1';s.title='Exact name: '+s.textContent;s.textContent=s.textContent.replace(/hermes/gi,'aqeelos')})}}

/* ---------- shared channels: one agent receives, the agents you pick can also send through it ---------- */
async function channelShareDrawer(owner,platform){let sh={},rec=[],agents=[];
 try{[sh,rec,agents]=await Promise.all([UI('/ui/channels/shares').then(r=>r.shares||{}),UI('/ui/channels/recipients?owner='+encodeURIComponent(owner)+'&platform='+platform).then(r=>r.recipients||[]),H('/profiles').then(r=>(r.profiles||[]).map(x=>x.name))])}catch(e){return fail(e)}
 const cur=sh[owner+'|'+platform]||{senders:[],chat:''};const others=agents.filter(a=>a!==owner);
 const d=drawer(pretty(platform)+' · who can send',`<p class="hint" style="margin:0 0 10px"><b>${esc(ident(owner).name)}</b> owns this ${esc(pretty(platform))} and receives every reply. The agents you tick can also <b>send</b> you messages through it (tagged with their name): from schedules, or with their "notify me" tool. No AI runs to pass them on.</p>
  <label>Who can send</label>${others.map(a=>`<label class="capt"><input type="checkbox" value="${esc(a)}" ${cur.senders.includes(a)?'checked':''}>${agentAva(a)}<span>${esc(ident(a).name)}</span></label>`).join('')||'<p class="hint">There are no other agents yet.</p>'}
  <label>Sends to</label><select id="csTo">${rec.length?rec.map(p=>`<option value="${esc(p.id)}" ${p.id===cur.chat?'selected':''}>${esc(p.name)} (${esc(p.id)})</option>`).join(''):'<option value="">Nobody approved yet</option>'}</select>
  <p class="hint" style="margin:4px 0 0">People approved under Channels › Who can message for this channel.</p>
  <div style="display:flex;gap:8px;margin-top:16px"><button id="csTest">${icon('send',15)}Send a test message</button></div>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="csGo">Save</button>`);
 const vals=()=>({owner,platform,senders:[...d.querySelectorAll('input[type=checkbox]:checked')].map(i=>i.value),chat:$('#csTo').value});
 d.querySelector('#csGo').onclick=async()=>{try{await put(UI,'/ui/channels/shares',vals());closeLayers();toast('Saved. Those agents get a "notify me" tool within a minute and can pick this channel in schedules.');reload()}catch(e){fail(e)}};
 d.querySelector('#csTest').onclick=async()=>{const b=d.querySelector('#csTest');b.disabled=true;const v=vals();const from=v.senders[0]||owner;
  try{await put(UI,'/ui/channels/shares',v);await post(UI,'/ui/channels/send',{from,owner,platform,chat:v.chat,text:'Test from aqeelOS: sending through this channel works.'});toast('Sent as '+ident(from).name+'. Check your '+pretty(platform)+'.')}catch(e){fail(e)}finally{b.disabled=false}}}
ACT['ch-share']=a=>channelShareDrawer(a.dataset.owner,a.dataset.platform);
// who can send through a channel is shown in its panel (ChX), not as a chip on the row

/* ---------- Extra connections: a second (third…) WhatsApp, Telegram… for the same agent ----------
   Each one is a hidden linked copy of the agent that shares its personality, memory, skills and tools.
   Setting one up reuses the normal channel screens, pointed at the copy (S.chOverride). */
addEventListener('hashchange',()=>{if(S.chOverride){S.chOverride=null;S.chOverrideInfo=null}});
const linkTitle=l=>l.label||pretty(l.platform)+' '+l.n;
// the ID an agent uses to pick this channel ("notify me on shop-whatsapp"); same rule as relay.mjs
const linkId=l=>String(l.label||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||l.platform+'-'+l.n;
ACT['ch-extra-add']=async a=>{const agent=S.profile||'default',platform=a.dataset.id;
 if(!await confirmBox(`Add another ${appName(platform)} to ${ident(agent).name}?`,`It answers as ${ident(agent).name}: same personality, memory, skills and tools, on a different ${appName(platform)} account. Chats on it stay separate from this one.${platform==='whatsapp'?' Next you scan a QR code with the other phone.':''}`,platform==='whatsapp'?'Add and show the QR code':'Add',false))return;
 try{toast('Preparing a new connection…');const l=await post(UI,'/ui/channels/links',{agent,platform});
  if(platform==='whatsapp')return linkWhatsApp(l.name,{title:'Link '+appName(platform)+' '+l.n+' · '+ident(agent).name});
  ACT['ch-extra-open']({dataset:{name:l.name,platform,n:l.n,agent}})}catch(e){fail(e)}};
ACT['ch-extra-open']=a=>{S.chOverride=a.dataset.name;S.chOverrideInfo={platform:a.dataset.platform,n:a.dataset.n,agent:a.dataset.agent||S.profile||'default',label:a.dataset.label||''};reload()};
ACT['ch-extra-done']=()=>{S.chOverride=null;S.chOverrideInfo=null;reload()};
ACT['ch-extra-rename']=async a=>{const was=a.dataset.label||'This connection';const v=await promptBox('Rename '+was,'Name for this connection (for example “Shop WhatsApp”)',a.dataset.label||'','Rename');if(v==null||v.trim()===(a.dataset.label||''))return;try{await put(UI,'/ui/channels/links',{agent:a.dataset.agent,name:a.dataset.name,label:v});toast(was+' renamed to '+(v.trim()||'its app name'));reload()}catch(e){fail(e)}};
ACT['ch-extra-remove']=async a=>{if(!await confirmBox('Remove '+a.dataset.title+'?','Its login and settings are deleted. '+ident(a.dataset.agent).name+' and its other channels are not touched.','Remove'))return;
 try{await del(UI,'/ui/channels/links',{agent:a.dataset.agent,name:a.dataset.name});toast(a.dataset.title+' removed from '+ident(a.dataset.agent).name);S.chOverride=null;reload()}catch(e){fail(e)}};
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{
 const o=S.chOverrideInfo,gone=pageTok(el);
 if(S.chOverride&&o){await base(p,el);if(gone())return;
  // setting up an extra connection: only that app, with a clear header
  el.querySelectorAll('.grid-cards [data-id]').forEach(c=>{if(c.dataset.id!==o.platform)c.remove()});
  el.insertAdjacentHTML('afterbegin',`<div class="panel card extra-head" style="margin-bottom:16px"><div class="row" style="padding:0;border:0"><div class="main-c">${chLogo(o.platform,pretty(o.platform))}<div class="txt"><b>${esc(o.label||pretty(o.platform)+' '+o.n)} for ${esc(ident(o.agent).name)}</b><span>Answers as ${esc(ident(o.agent).name)}: same personality, memory, skills and tools. Open the card below to connect it.</span></div></div><div class="act"><button class="primary" data-act="ch-extra-done">${icon('check',15)}Done</button></div></div></div>`);
  return}
 const agent=S.profile||'default';const pL=UI('/ui/channels/links?agent='+encodeURIComponent(agent)).catch(()=>({links:[]}));const pC=UI('/ui/channels').catch(()=>({channels:[]}));
 await base(p,el);if(gone())return;
 // "Add another" on every app this agent already uses
 el.querySelectorAll('.grid-cards .card[data-id]').forEach(c=>{const pl=(Pages.platforms||[]).find(x=>x.id===c.dataset.id);if(!pl?.configured||['api_server','webhook'].includes(pl.id))return;
  c.querySelector('h3')?.insertAdjacentHTML('afterend','<span class="tile-id" title="Agents use the name '+esc(pl.id)+' to pick this channel">'+esc(accountText(pl.account,{id:pl.id}))+'</span>'+(pl.identity_error?'<span class="tile-id ch-pending">'+esc(pl.identity_error)+'</span>':''));
  if(pl.id==='whatsapp'&&pl.needs_link){c.querySelector('.tile-foot')?.insertAdjacentHTML('beforeend',`<span class="add-another" role="button" tabindex="0" data-act="wa-link" data-agent="${esc(agentProfile()||'default')}">${icon('refresh',14)}Link again</span>`);return}
  // WhatsApp Business setup can't use an extra account yet, so it gets no Add another
  if(pl.state!=='connected'||pl.id==='whatsapp_cloud')return;
  c.querySelector('.tile-foot')?.insertAdjacentHTML('beforeend',`<span class="add-another" role="button" tabindex="0" data-act="ch-extra-add" data-id="${esc(pl.id)}" title="Connect another ${esc(appName(pl.id))} account to this agent">${icon('plus',14)}Add another</span>`)});
 const [{links=[]},{channels=[]}]=await Promise.all([pL,pC]);if(gone()||!links.length)return;
 const st_=n=>channels.find(c=>c.agent===n);
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginBottom='16px';
 panel.innerHTML=`<h2>Extra connections</h2><p class="sub">More accounts of the same app for ${esc(ident(agent).name)}. Each answers as ${esc(ident(agent).name)}. To have it message you on one, name its ID, for example “notify me on <code>${esc(linkId(links[0]))}</code>”. The first account of each app has the app’s name as ID (<code>${esc(links[0].platform)}</code>).</p>${links.map((l,i)=>{const c=st_(l.name);return `<div class="row" ${st(i)} style="padding:12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="main-c">${chLogo(l.platform,pretty(l.platform))}<div class="txt"><b>${esc(linkTitle(l))}</b><span>${c?chDot(c)+esc(chState(c)):'<i class="dot"></i>Not connected yet'} · <span class="id-code" title="The ID agents use for this connection">ID ${esc(linkId(l))}</span></span></div></div>
  <div class="act"><button data-act="ch-extra-open" data-name="${esc(l.name)}" data-platform="${esc(l.platform)}" data-n="${l.n}" data-agent="${esc(l.agent)}" data-label="${esc(l.label||'')}">${icon('sliders',15)}${c?'Manage':'Connect'}</button><button class="ghost icon" data-act="ch-extra-rename" data-name="${esc(l.name)}" data-agent="${esc(l.agent)}" data-label="${esc(l.label||'')}" title="Rename" aria-label="Rename">${icon('edit',15)}</button><button class="ghost icon" data-act="ch-extra-remove" data-name="${esc(l.name)}" data-agent="${esc(l.agent)}" data-title="${esc(linkTitle(l))}" title="Remove" aria-label="Remove">${icon('trash',15)}</button></div></div>`}).join('')}`;
 el.querySelector('.grid-cards')?.before(panel)}}

/* ---------- Duplicate: a second copy of an MCP tool or a skill on the same agent ---------- */
async function duplicateItem(kind,name){const v=await promptBox('Duplicate '+name,kind==='mcp'?'Name for the copy. It keeps the same settings; change its keys or login after.':'Name for the copy. Edit it separately afterwards.',name+'-2',kind==='mcp'?'Duplicate':'Duplicate');if(!v)return;
 try{const r=await post(UI,'/ui/share/duplicate',{kind,agent:(agentProfile()||'default'),name,to:v.trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-')});toast('Added '+r.name+'.');reload()}catch(e){fail(e)}}
// (MCP rows already have their own Duplicate button in pages.js)
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;el.querySelectorAll('[data-act="sk-open"][data-name]').forEach(row=>{const act=row.querySelector('.act');if(!act||act.querySelector('.dup-btn'))return;
 const b=document.createElement('button');b.className='ghost icon dup-btn';b.title='Duplicate (a copy to change separately)';b.setAttribute('aria-label','Duplicate');b.innerHTML=icon('copy',16);b.onclick=e=>{e.stopPropagation();duplicateItem('skill',row.dataset.name)};act.prepend(b)})}}

/* ---------- Models › Images: which service makes pictures (any chat model can ask it) ---------- */
const IMG_FRIENDLY={'OpenAI (Codex auth)':'ChatGPT, with your sign-in (GPT Image 2)','OpenRouter (image)':'OpenRouter (Gemini, GPT Image, Krea…)','FAL.ai':'FAL (Gemini Nano Banana, Flux…)','xAI Grok Imagine (image)':'Grok Imagine'};
{const base=PAGES.models;PAGES.models=async(p,el)=>{const pc=H('/tools/toolsets/image_gen/config').catch(()=>null),gone=pageTok(el);await base(p,el);if(gone()||S.me?.admin===false)return;
 const panel=document.createElement('div');panel.className='panel card';
 panel.innerHTML=`<h2>Images</h2><p class="sub">Who makes pictures when you ask any agent for one, whatever chat model it uses.</p><div class="row" style="padding:12px 0 0;border:0"><div class="main-c"><span class="ic blue">${icon('sparkle',16)}</span><div class="txt"><b class="img-now"><span class="skel" style="display:inline-block;width:180px;height:14px"></span></b><span>Images show right in the chat.</span></div></div><div class="act"><button data-act="ts-setup" data-name="image_gen">${icon('sliders',15)}Change</button></div></div>`;
 const anchor=[...el.querySelectorAll('.panel h2')].find(h=>/Helper models/.test(h.textContent))?.closest('.panel');(anchor||el.querySelector('.panel'))?.after(panel);
 const cfg=await pc;if(gone())return;const now=(cfg?.providers||[]).find(x=>x.is_active);const b=panel.querySelector('.img-now');if(b)b.textContent=now?(IMG_FRIENDLY[now.name]||now.name):'Not set up yet';}}

/* ---------- MCP sign-in (OAuth). Sign-ins come back to this site; a service without automatic app
   registration (Slack, Google…) first needs its own app's Client ID and Secret, asked for here. ---------- */
const OAUTH_APP_HELP={slack:['Slack','https://api.slack.com/apps','Create New App › From scratch. Under OAuth & Permissions add the Redirect URL below and the scopes the Slack MCP needs, then copy the Client ID and Client Secret from Basic Information.'],
 google:['Google','https://console.cloud.google.com/apis/credentials','Create an OAuth client (Web application) and add the Redirect URL below as an authorised redirect URI.'],
 github:['GitHub','https://github.com/settings/developers','New OAuth App, with the Redirect URL below as the callback URL.']};
async function mcpClientDrawer(name,reason,agent=agentProfile()||'default'){let redirect='';try{redirect=(await UI('/ui/mcp/oauth-redirect?name='+encodeURIComponent(name))).redirect}catch{}
 const key=Object.keys(OAUTH_APP_HELP).find(k=>name.toLowerCase().includes(k));const [who,link,how]=OAUTH_APP_HELP[key]||[pretty(name),'','Create an OAuth app with this service, add the Redirect URL below to it, then paste its Client ID and Secret.'];
 const d=drawer('Connect '+pretty(name),`<p class="hint" style="margin:0 0 10px"><b>Set up your own app.</b> ${esc(who)} does not let apps register themselves, so it needs an app of your own (one time). ${esc(how)}${link?` <a href="${esc(link)}" target="_blank" rel="noopener">Open ${esc(who)}’s app page</a>`:''}</p>
  <label>Redirect URL (paste into ${esc(who)})</label><div style="display:flex;gap:8px"><input id="ocRedir" readonly value="${esc(redirect)}"><button class="ghost" id="ocCopy">${icon('copy',15)}Copy</button></div>
  <label>Client ID</label><input id="ocId" autocomplete="off"><label>Client Secret</label><input id="ocSecret" type="password" autocomplete="new-password">
  ${reason?`<p class="hint" style="margin-top:12px">Engine said: ${esc(reason.split('\n')[0])}</p>`:''}`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="ocGo">Save and sign in</button>`);
 d.querySelector('#ocCopy').onclick=()=>copyText(redirect);
 d.querySelector('#ocGo').onclick=async()=>{try{await post(UI,'/ui/mcp/oauth-client',{agent,name,client_id:$('#ocId').value,client_secret:$('#ocSecret').value});closeLayers();await new Promise(r=>setTimeout(r,2500));ACT['mcp-auth']({dataset:{name,agent}})}catch(e){fail(e)}}}
ACT['mcp-auth']=async a=>{const name=a.dataset.name,agent=a.dataset.agent||agentProfile()||'default';
 // a tab opened right away (popup blockers allow it only now); it is pointed at the sign-in page once known
 const win=window.open('about:blank','_blank');
 try{const f=await post(UI,'/ui/mcp/start-signin',{agent,name});const url=f.authorization_url||f.auth_url||f.url;
  if(!url){win?.close();const err=f.error||'';if(/client registration|client_id|client id/i.test(err))return mcpClientDrawer(name,err,agent);return fail(new Error(err||'The service did not offer a sign-in.'))}
  if(!/^https:\/\//i.test(String(url||''))){win?.close();return toast('That sign-in link does not look right, so it was not opened.','err')}
  if(win){win.opener=null;win.location=url}else window.open(url,'_blank','noopener');
  const d=drawer('Sign in to '+pretty(name),`<p style="color:var(--ink-2);margin:0 0 12px">Finish signing in in the tab that opened, then come back here.</p><p><a href="${esc(url)}" target="_blank" rel="noopener">Open the sign-in page again</a></p><p class="hint" id="mcpSt">Waiting for you to sign in…</p>`);
  // a check that fails is tried again a few times; a closed sign-in tab gets a few more checks, then says so
  const id=f.flow_id;let errs=0,shut=0;for(let i=0;i<150&&d.isConnected&&id;i++){await new Promise(r=>setTimeout(r,2000));let s;try{s=await H(prof('/mcp/oauth/flows/'+encodeURIComponent(id),agent));errs=0}catch(e){if(++errs>=4){d.querySelector('#mcpSt').textContent='Lost touch with the sign-in: '+(e.message||'no answer')+'. Press Sign in again.';return}continue}
   const st=s.status||'';d.querySelector('#mcpSt').textContent=/authorization_required|pending|starting/.test(st)?'Waiting for you to sign in…':'Status: '+pretty(st);
   if(/approved|complete|success|done|connected|authorized/.test(st)){closeLayers();toast('Signed in to '+pretty(name)+(s.tools?.length?' · '+s.tools.length+' tools':''));reload();return}
   if(/error|fail|expired|cancel/.test(st)){d.querySelector('#mcpSt').textContent='Did not finish: '+(s.error||st);return}
   if(win&&win.closed&&++shut>=4){d.querySelector('#mcpSt').textContent='The sign-in tab was closed before it finished. Press Sign in to try again.';return}}}
 catch(e){win?.close();fail(e)}};

/* ---------- The built-in "notify me" tool (aqeelos-notify): made by aqeelOS, kept on agents that have a
   channel. It can be switched off, not deleted or signed in to. ---------- */
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;const row=el.querySelector('.row[data-mcp="aqeelos-notify"]');if(!row)return;
 row.querySelectorAll('.act button').forEach(b=>{if(!b.closest('.switch')&&!b.closest('.share-box'))b.remove()});row.querySelector('.share-box')?.remove();
 const txt=row.querySelector('.txt');if(txt){const sub=txt.querySelector('span:not(.access):not(.chip)');if(sub)sub.textContent='Lets this agent message you on WhatsApp, Telegram and your other channels ("notify me on whatsapp"). Added by aqeelOS; switch it off to stop.';
  txt.querySelector('b')?.insertAdjacentHTML('beforeend',' <span class="chip blue" title="Part of aqeelOS, kept on every agent that has a channel">Built in</span>')}}}

/* ---------- Agents › Recently deleted: every deleted agent is kept for 30 days and can be restored ---------- */
{const base=PAGES.profiles;PAGES.profiles=async(p,el)=>{const stale=pageTok(el);await base(p,el);if(stale()||S.me?.admin===false)return;let items=[];try{items=(await UI('/ui/agent-trash')).items||[]}catch{return}if(stale()||!items.length)return;
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginTop='16px';
 panel.innerHTML=`<h2>Recently deleted</h2><p class="sub">Deleted agents are kept for 30 days. Restoring brings back its settings, skills, memory and chats.</p>${items.map((x,i)=>`<div class="row" ${st(i)} style="padding:12px;margin:0 -12px;border-top:1px solid var(--border)"><div class="main-c">${agentAva(x.agent)}<div class="txt"><b>${esc(ident(x.agent).name)}</b><span>Deleted ${esc(when(x.deleted))} · ${esc(bytes(x.size))}</span></div></div><div class="act"><button class="ghost" data-act="agent-purge" data-file="${esc(x.file)}" data-name="${esc(ident(x.agent).name)}" style="color:var(--bad)">${icon('trash',15)}Delete forever</button><button data-act="agent-restore" data-file="${esc(x.file)}" data-name="${esc(ident(x.agent).name)}">${icon('refresh',15)}Restore</button></div></div>`).join('')}`;
 el.append(panel)}}
/* ---------- Agents: an agent whose setup did not finish says so, with one click to finish it ---------- */
{const base=PAGES.profiles;PAGES.profiles=async(p,el)=>{const stale=pageTok(el);await base(p,el);if(stale())return;let st={};try{st=(await UI('/ui/agent-setup')).agents||{}}catch{return}if(stale())return;
 for(const [n,v] of Object.entries(st)){if(v.ok)continue;const tags=el.querySelector('.agent-card[data-name="'+CSS.escape(n)+'"] .agent-tags');if(!tags)continue;
  tags.insertAdjacentHTML('beforeend',`<span class="chip warn" title="${esc((v.failed||[]).join(' · '))}">${icon('alert',12)}Setup not finished</span><button class="small" data-act="agent-fix" data-name="${esc(n)}">Finish setup</button>`)}}}
ACT['agent-fix']=async a=>{a.disabled=true;const was=a.textContent;a.textContent='Finishing…';
 try{const r=await post(UI,'/ui/accounts/setup-agent',{name:a.dataset.name});if(r.ok)toast('Setup finished');else toast('Not finished yet: '+(r.failed||[]).join(' · '),'err');reload()}catch(e){a.disabled=false;a.textContent=was;fail(e)}};
ACT['agent-purge']=async a=>{if(!await confirmBox('Delete '+a.dataset.name+' forever?','Its kept backup (settings, skills, memory and chats) is removed now. This cannot be undone.','Delete forever'))return;a.disabled=true;
 try{await post(UI,'/ui/agent-trash/purge',{file:a.dataset.file});toast(a.dataset.name+' deleted for good');const row=a.closest('.row');row?.classList.add('closing');laterReload(300)}catch(e){a.disabled=false;fail(e)}};
ACT['agent-restore']=async a=>{if(!await confirmBox('Restore '+a.dataset.name+'?','It comes back as it was when it was deleted.','Restore',false))return;a.disabled=true;
 try{await post(UI,'/ui/agent-restore',{file:a.dataset.file});S._viewList=null;toast(a.dataset.name+' is back');laterReload(1500)}catch(e){a.disabled=false;fail(e)}};


/* ---------- Chat › usage %: a small card with this account's limits, right where you are ---------- */
ACT['meter-card']=a=>{document.querySelector('.meter-card')?.remove();const prov=Chat.cur()?.provider||Chat.defProv;const ws=(Chat.usage||{})[prov]||[];if(!ws.length)return;
 const m=Chat.cur();const card=document.createElement('div');card.className='meter-card';card.setAttribute('role','dialog');
 const row=w=>{const u=Math.round(Number(w.used_percent)||0),c=u>=90?'bad':u>=70?'warn':'ok';return `<div class="mc-row"><div class="mc-top"><span>${esc(w.label||'Limit')}</span><b>${u}%</b></div><i class="mc-bar ${c}"><s style="width:${Math.min(100,u)}%"></s></i>${w.resets_at?`<small>Resets ${esc(when(w.resets_at))}</small>`:''}</div>`};
 card.innerHTML=`<div class="mc-head"><b>${esc(m?.providerName||provLabel(prov))}</b><span>${esc(m?.label||'')}</span></div>${ws.map(row).join('')}
  ${S.me?.admin!==false?`<button class="ghost small mc-more" data-go="/models/accounts">See all accounts${icon('chevR',14)}</button>`:''}`;
 document.body.append(card);const r=a.getBoundingClientRect(),w=Math.min(300,innerWidth-24);card.style.width=w+'px';
 card.style.left=Math.max(12,Math.min(r.left+r.width/2-w/2,innerWidth-w-12))+'px';card.style.top=Math.max(12,r.top-card.offsetHeight-10)+'px';
 const off=e=>{if(!card.contains(e.target)&&!e.target.closest('[data-act="meter-card"]')){card.remove();document.removeEventListener('pointerdown',off,true)}};
 setTimeout(()=>document.addEventListener('pointerdown',off,true),0);card.querySelector('.mc-more')?.addEventListener('click',()=>card.remove())};
addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.meter-card')?.remove()});
addEventListener('hashchange',()=>document.querySelector('.meter-card')?.remove());

/* ---------- Channel checks: a button on every connection, and a pop-up when one needs attention ---------- */
ACT['ch-apply']=a=>reconnectChannel(a.dataset.agent,a.dataset.platform);
ACT['ch-check']=async a=>{const was=a.innerHTML;a.disabled=true;a.innerHTML='<span class="spinner"></span>';
 try{const r=await post(UI,'/ui/channels/check',{agent:a.dataset.agent,platform:a.dataset.platform});toast(appName(a.dataset.platform)+' · '+ident(a.dataset.agent.split('--')[0]).name+': '+r.text,r.connected?undefined:'err');
  const row=a.closest('.row');const shown=row?.querySelector('.ch-status')?.textContent||'';if(r.connected!==/Connected/.test(shown))reload()}catch(e){fail(e)}finally{a.disabled=false;a.innerHTML=was}};
ACT['wa-remove']=async a=>{const ag=a.dataset.agent;const name=ident(ag.split('--')[0]).name;
 if(!await confirmBox('Remove this WhatsApp from '+name+'?','Its connection stops and the ended login is cleared. Chats and approved people stay, and you can link a phone again any time.','Remove'))return;
 try{await post(UI,'/ui/channels/whatsapp/remove',{agent:ag});toast('WhatsApp removed from '+name);reload()}catch(e){fail(e)}};
// the drawer's Test button does the same full check
{const base=ACT['ch-test'];ACT['ch-test']=async a=>{const id=a.dataset.id;if(!['whatsapp','telegram'].includes(id))return base(a);
 try{const r=await post(UI,'/ui/channels/check',{agent:agentProfile()||'default',platform:id});toast(r.text,r.connected?undefined:'err')}catch(e){fail(e)}}}
const ChannelAlert={
 async check(){if(document.hidden||!S.signedIn||S.me?.admin===false)return;let items=[];try{items=(await UI('/ui/channels/attention')).items||[]}catch{return}
  for(const x of items){const k='chAlert:'+x.agent+'|'+x.id;let seen=0;try{seen=+localStorage.getItem(k)||0}catch{}if(Date.now()-seen<6*3600e3)continue;
   if(document.querySelector('.cron-pop[data-k="'+CSS.escape(k)+'"]'))continue;this.show(x,k)}},
 show(x,k){const who=ident(x.base||x.agent).name+(x.agent.includes('--')?' (extra number)':'');
  Notices.show({icon:'alert',kind:'warn',key:k,life:600000,go:'/channels/channels',title:appName(x.id)+' '+(x.needs_link?'logged out':'not connected'),
   text:who+(x.account?' · '+accountText(x.account):'')+'. '+(x.needs_link?'Link it again, or remove it if it is no longer used.':'Open Channels to check it.'),
   actions:[x.id==='whatsapp'&&x.needs_link?{label:'Link again',run:()=>ACT['wa-link']({dataset:{agent:x.agent}})}:{label:'Open',go:'/channels/channels'}],
   onClose:()=>{try{localStorage.setItem(k,String(Date.now()))}catch{}}})}};
Poll.add(()=>ChannelAlert.check(),10*60e3,6000);

/* ---------- Channels page: status lives in "Every agent's channels" at the top; the cards below are only for
   adding (the app, and Set up or Add another). People who don't see the top list keep the status on the cards. ---------- */
{const base=PAGES.channels;PAGES.channels=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if(S.me?.admin===false||S.chOverride)return;const grid=el.querySelector('.grid-cards');if(!grid)return;
 if(!el.querySelector('.ch-cat-head')){const pl=Pages.platforms||[];grid.insertAdjacentHTML('beforebegin',`<div class="ch-cat-head"><h2 class="h-row">Add a channel<small class="ch-count">${pl.filter(x=>x.configured).length} of ${pl.length} set up</small></h2><p class="sub">Connect an app, or another account of one this agent already uses. Connected ones are listed above.</p></div>`)}
 const ag=agentProfile()||'default';
 grid.querySelectorAll('.card[data-id]').forEach(c=>{const pl=(Pages.platforms||[]).find(x=>x.id===c.dataset.id);if(!pl)return;
  c.querySelectorAll('h3 .access,.tile-id').forEach(x=>x.remove());const foot=c.querySelector('.tile-foot');if(!foot)return;
  const built=['api_server','webhook'].includes(pl.id),has=pl.configured||pl.account;const ok=pl.state==='connected';
  const lbl=built?'<span class="cat-note">Built in · every agent</span>':has&&ok?pl.id==='whatsapp_cloud'?'':`<span class="add-another" role="button" tabindex="0" data-act="${pl.id==='whatsapp'?'wa-add':'ch-extra-add'}" data-id="${esc(pl.id)}">${icon('plus',14)}Add another</span>`:
   pl.id==='whatsapp'?(pl.paused?'<span class="cat-note">Paused</span>':has&&!pl.needs_link?'<span class="cat-note">Reconnecting</span>':`<span class="add-another" role="button" tabindex="0" data-act="wa-link" data-agent="${esc(ag)}">${icon('plus',14)}${has?'Link again':'Set up'}</span>`):`<span class="add-another" role="button" tabindex="0" data-act="ch-open" data-id="${esc(pl.id)}">${icon('plus',14)}${has?'Fix':'Set up'}</span>`;
  foot.innerHTML=lbl+'<span style="color:var(--muted)">'+icon('chevR',16)+'</span>'})}}
ACT['wa-add']=a=>ACT['ch-extra-add']({dataset:{id:'whatsapp'}});

// the protected secret field (Secrets in chat.js): its buttons
ACT['secret-send']=a=>Secrets.send(a.closest('.secret-card'));
ACT['secret-cancel']=a=>Secrets.cancel(a.closest('.secret-card'));
ACT['secret-eye']=a=>{const i=(a.closest('.sc-field')||a.closest('.sc-row'))?.querySelector('input')||a.closest('.sc-main')?.querySelector('[data-val]');if(!i)return;const show=i.type==='password';i.type=show?'text':'password';a.setAttribute('aria-pressed',String(show));const t=a.querySelector('span');if(t)t.textContent=show?'Hide':'Show';i.focus()};
ACT['secret-give']=()=>Secrets.give();

// "Which browser?" card buttons, and the one-time setup of the aqeelOS extension (use my browser)
ACT['browser-pick']=a=>Secrets.pickBrowser(a.closest('.secret-card'),a.dataset.where);
const BrowserSetup={
 async open(){let st={};try{st=await UI('/ui/local-browser/status')}catch{}
  const d=sideDrawer('Use my browser',`<div class="lb-state ${st.connected?'on':''}"><i class="dot"></i>${st.connected?'Your browser is connected'+(st.version?' (version '+esc(st.version)+')':''):'Not connected yet'}</div>
   ${st.connected&&st.latest&&st.version!==st.latest?`<div class="lb-upd">${icon('refresh',14)}<span><b>Version ${esc(st.latest)} is ready.</b> <a href="/ui/local-browser/extension.zip" download>Download it</a>, unzip it over your current aqeelos-browser folder, then press the reload arrow on the extension in <code>chrome://extensions</code>.</span></div>`:''}
   <p class="hint" style="margin:10px 0 14px">With the aqeelOS extension, an agent can work in your own Chrome when you choose “My browser”, in its own tab group you can watch, with the sign-ins you already have. The tab glows while it works, a cursor shows where it clicks, and you can press Stop or Take over any time. The extension also has a side chat (Alt+A). Good for one-off jobs (Google Cloud, admin pages). Anything that must keep running stays on the AI box.</p>
   <ol class="qr-steps lb-steps"><li><a href="/ui/local-browser/extension.zip" download>Download the extension</a> and unzip it (right-click › Extract all).</li>
    <li>In Chrome, open <code>chrome://extensions</code> and switch on <b>Developer mode</b> (top right).</li>
    <li>Click <b>Load unpacked</b> and pick the unzipped <b>aqeelos-browser</b> folder.</li>
    <li>Click the round white aqeelOS icon in Chrome’s toolbar (pin it from the puzzle icon) and press <b>Connect</b>. Use the Chrome where you are signed in to aqeelOS.</li></ol>
   <p class="hint">It only does what an agent’s browser does (open pages, read them, click, type, press keys, scroll, go back), only in chats where you chose it, and you can disconnect from its icon any time.</p>`,
   `<button class="ghost" data-act="close">Close</button><button class="primary" id="lbCheck">${icon('refresh',15)}Check connection</button>`);
  d.querySelector('#lbCheck').onclick=async()=>{try{const s=await UI('/ui/local-browser/status');toast(s.connected?'Your browser is connected':'Not connected yet. Press Connect in the extension.',s.connected?undefined:'err');if(s.connected)closeLayers()}catch(e){fail(e)}}}};
ACT['browser-setup']=()=>BrowserSetup.open();

// remove a channel connection: it goes off and its token or login is deleted (the agent and its chats stay)
ACT['ch-remove']=async a=>{const ag=a.dataset.agent,pf=a.dataset.platform,name=ident(ag.split('--')[0]).name;
 if(!await confirmBox('Remove '+appName(pf)+' from '+name+'?','Its connection stops and its saved token is deleted. Chats and the agent stay. To only stop answers for a while, choose “Nobody (paused)” under Belongs to instead.','Remove'))return;
 try{await post(UI,'/ui/channels/remove',{agent:ag,platform:pf});toast(appName(pf)+' removed from '+name);reload()}catch(e){fail(e)}};
ACT['lb-off']=async()=>{try{await post(UI,'/ui/local-browser/off',{session:Chat.id});toast('This chat uses the AI box screen again');Chat.paintComposerBar()}catch(e){fail(e)}};

// the ⋯ menu on a channel row: everything except "Belongs to", in one place
ACT['ch-more']=a=>{const ag=a.dataset.agent,pf=a.dataset.platform,paused=!!a.dataset.paused,extra=!!a.dataset.extra,wa=pf==='whatsapp';
 menu(a,[{label:'Check connection',icon:'activity',run:()=>ACT['ch-check']({dataset:{agent:ag,platform:pf},innerHTML:'',closest:()=>a.closest('.row')})},
  !extra&&{label:'Who can send through it',icon:'user',run:()=>channelShareDrawer(ag,pf)},
  {label:a.dataset.note?'Edit the note':'Add a note (what it is for)',icon:'edit',run:async()=>{const v=await promptBox('Note for '+appName(pf),'What is it for? (only you see this)',a.dataset.note||'','Save');if(v==null)return;try{await put(UI,'/ui/channels/note',{agent:ag,platform:pf,note:v});toast(appName(pf)+' note saved');reload()}catch(e){fail(e)}}},
  !paused&&{label:'Reconnect',icon:'refresh',run:()=>reconnectChannel(ag,pf)},   // a paused channel stays off until someone picks who answers it
  wa&&{label:'Link a different phone (new QR)',icon:'refresh',run:()=>ACT['wa-replace']({dataset:{agent:ag}})},
  '-',{label:wa?'Remove this WhatsApp':'Remove this connection',icon:'trash',bad:true,run:()=>wa?ACT['wa-remove']({dataset:{agent:ag}}):ACT['ch-remove']({dataset:{agent:ag,platform:pf}})}])};
// pause or resume a channel: a pause says it stays linked, with Undo in the toast; true when it went through
async function setPaused(ag,pf,on,what=appName(pf)){
 try{const r=await post(UI,'/ui/channels/pause',{agent:ag,platform:pf,on:!on});const m=what+(on?' paused · stays linked, nobody answers it until you pick an agent under Belongs to':' answers again')+(r.restarting?' · the main agent’s channels restart for a moment':'');if(on)toastUndo(m,()=>setPausedQuiet(ag,pf,false));else toast(m);reload();laterReload(4000);return true}catch(e){fail(e);return false}}
async function setPausedQuiet(ag,pf,on){await post(UI,'/ui/channels/pause',{agent:ag,platform:pf,on:!on});reload()}
// reconnect one channel: on a second agent only that channel restarts; the main agent's channels share the engine
async function reconnectChannel(ag,pf){const main=ag.split('--')[0]==='default'&&!ag.includes('--');
 if(main&&!await confirmBox('Reconnect '+appName(pf)+'?','The main agent’s channels only reconnect by restarting the engine, so every agent pauses for about 20 seconds (replies in progress finish first).','Reconnect',false))return;
 try{const r=await post(UI,'/ui/channels/reconnect',{agent:ag,platform:pf});toast(r.restarting?'Reconnecting: the engine restarts once replies in progress finish':appName(pf)+' reconnected');laterReload(r.restarting?20000:3000)}catch(e){fail(e)}}

// the bell (Inbox lives in notices.js, which loads before the action table)
ACT['inbox']=()=>{if($('.drawer.inbox'))return closeLayers();Inbox.open()};
setTimeout(()=>Inbox.paintBell(),300);setInterval(()=>{if(!document.hidden)Inbox.paintBell()},2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)Inbox.load()});

// engine restarts land in the bell with the reason in plain words (so a channel dropping for a moment is explained)
const SysEvents={async check(){if(document.hidden||!S.signedIn||S.me?.admin===false)return;let ev=[];try{ev=(await UI('/ui/system-events')).events||[]}catch{return}
 const seen=new Set(store.get('sysSeen',[]));let n=0;
 for(const e of ev){if(seen.has(e.id))continue;seen.add(e.id);n++;const w=e.why||'';
  const why=e.kind==='restart-self'?'The engine restarted on its own, usually after a settings change.':/^restart from the app/.test(w)?'Someone pressed Restart agents.':/WhatsApp linked/.test(w)?'A WhatsApp number was linked.':/removed from/.test(w)?'A channel was removed.':/^reconnect/.test(w)?'A channel of the main agent was reconnected.':/^(paused|resumed)/.test(w)?'A channel was paused or resumed.':/no gateway was running/.test(w)?'It had stopped, so it was started again.':/restored/.test(w)?'An agent was restored.':/cannot reach/.test(w)?'It had lost its model sign-in, so it was restarted properly.':w;
  if(/^memory/.test(e.kind)){Inbox.add({key:'sys:'+e.id,group:'sys:memory',repeat:false,icon:'activity',kind:e.kind==='memory'?'warn':'blue',title:e.kind==='memory'?'The AI box is low on RAM':'RAM freed',text:e.kind==='memory'?e.why+'. Heavy jobs may fail; idle browsers close by themselves.':e.why,go:'/system/health',actions:[{label:'Health',go:'/system/health'}]});continue}
  Inbox.add({key:'sys:'+e.id,group:'sys:restart',repeat:false,icon:'refresh',kind:'blue',title:'Agents restarted for a moment',text:why+' Channels (WhatsApp, Telegram, Slack) reconnected by themselves.',go:'/channels/channels',actions:[{label:'Channels',go:'/channels/channels'}]})}
 if(n)store.set('sysSeen',[...seen].slice(-100))}};
Poll.add(()=>SysEvents.check(),60000,8000);

// an agent without a description: one click to write one
ACT['agent-describe']=async(a,e)=>{e?.preventDefault();e?.stopPropagation();const n=a.dataset.name;const v=await promptBox('Describe '+ident(n).name,'What does it do? (one sentence)','','Save');if(!v)return;
 try{await put(H,'/profiles/'+encodeURIComponent(n)+'/description',{description:v.trim()});toast('Saved');reload()}catch(er){fail(er)}};

/* ---------- WhatsApp Business (Meta's official Cloud API): a number that never logs out. Guided steps for Meta's
   developer site, the two fields that matter, and the address plus check word to paste back into Meta. ---------- */
{const base=ACT['ch-open'];ACT['ch-open']=a=>a.dataset.id==='whatsapp_cloud'?waCloudDrawer():base(a)}
async function waCloudDrawer(){const ag=agentProfile()||'default';let s;try{s=await UI('/ui/channels/wa-cloud?agent='+encodeURIComponent(ag))}catch(e){return fail(e)}
 const c=(Pages.platforms||[]).find(x=>x.id==='whatsapp_cloud')||{};let ready=s.set.phone_number_id&&s.set.access_token;
 // every other setting the engine has for it (allowlists, policies…), in the engine's own field form
 const more=(c.env_vars||[]).filter(v=>!/^WHATSAPP_CLOUD_(PHONE_NUMBER_ID|ACCESS_TOKEN|APP_SECRET|VERIFY_TOKEN)$/.test(v.key));
 const copy=(label,v)=>`<div class="wac-copy"><span>${esc(label)}</span><code>${esc(v)}</code><button class="ghost icon" data-act="copy-text" data-text="${esc(v)}" aria-label="Copy ${esc(label)}">${icon('copy',15)}</button></div>`;
 const field=(k,label,hint,secret)=>`<label>${label}</label><input id="wac_${k}" ${secret?'type="password"':''} autocomplete="off" placeholder="${s.set[k]?'Saved · leave empty to keep':''}"><p class="hint">${hint}</p>`;
 const d=drawer('WhatsApp Business',`<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px"><span class="logo-lg">${chLogo('whatsapp','WhatsApp')}</span><div><b style="font-size:15px">WhatsApp Business for ${esc(ident(ag).name)}</b><div style="margin-top:4px">${ready||c.state==='connected'?chStateChip(c):'<span class="chip">Not set up</span>'}</div></div></div>
  <p class="hint" style="margin:0 0 12px">Meta's official connection for a business number. It never logs out like a linked phone can. Replies within 24 hours of a customer's message are free; starting a conversation later costs a small fee that Meta charges.</p>
  <ol class="qr-steps"><li>On <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a>, create an app of type <b>Business</b> and add <b>WhatsApp</b> to it.</li>
   <li>Under <b>WhatsApp › API Setup</b>, pick or add the business number, then copy its <b>Phone number ID</b> and an <b>access token</b> (for a token that does not expire: Business Settings › System users › Generate token).</li>
   <li>Paste both below and press <b>Save</b>.</li>
   <li>Under <b>WhatsApp › Configuration › Webhook</b>, paste the address and check word shown after saving, then subscribe to <b>messages</b>.</li></ol>
  ${field('phone_number_id','Phone number ID *','The long number under API Setup, not the phone number itself.')}
  ${field('access_token','Access token *','Starts with EAA…',true)}
  ${field('app_secret','App secret','App settings › Basic › App secret. Lets aqeelOS check that messages really come from Meta.',true)}
  ${more.length?`<details class="wac-more"><summary>More settings</summary><div class="wac-more-body">${more.map(chField).join('')}<button id="wacMore">Save these settings</button></div></details>`:''}
  <div id="wacOut">${s.verify_token?`<h3 style="font-size:14px;margin:16px 0 8px">Paste these into Meta</h3>${copy('Callback URL',s.callback)}${copy('Verify token',s.verify_token)}`:''}</div>`,
  `<button class="ghost" data-act="close">Close</button><button class="primary" id="wacSave">Save</button>`);
 chWire(d);
 d.querySelector('#wacMore')?.addEventListener('click',async e=>{const b=e.currentTarget;const {env,clear,bad}=chCollect(d,more);if(bad)return toast('Check the fields marked in red','err');if(!Object.keys(env).length&&!clear.length)return toast('Nothing to save. Change a setting first.','err');
  b.disabled=true;try{const r=await put(H,'/messaging/platforms/whatsapp_cloud',{env,...(clear.length?{clear_env:clear}:{})});toast(r.hot_served?'Settings saved':'Settings saved · restart the agents to apply them');if(!r.hot_served&&typeof chNeedRestart==='function')chNeedRestart()}catch(er){fail(er)}finally{b.disabled=false}});
 d.querySelector('#wacSave').onclick=async()=>{const b={};for(const k of ['phone_number_id','access_token','app_secret']){const v=d.querySelector('#wac_'+k).value.trim();if(v)b[k]=v}
  if(!Object.keys(b).length&&ready)return closeLayers();
  try{const r=await post(UI,'/ui/channels/wa-cloud?agent='+encodeURIComponent(ag),b);toast(r.on?'Saved. Now paste the address into Meta':'Saved. Switch the channel on after the agents restart');
   d.querySelector('#wacOut').innerHTML=`<h3 style="font-size:14px;margin:16px 0 8px">Paste these into Meta</h3>${copy('Callback URL',r.callback)}${copy('Verify token',r.verify_token)}`;
   for(const k in b){s.set[k]=true;const i=d.querySelector('#wac_'+k);i.value='';i.placeholder='Saved · leave empty to keep'}ready=s.set.phone_number_id&&s.set.access_token}catch(e){fail(e)}}}

// chat: load the earlier part of a long chat
ACT['hist-more']=async a=>{const id=Chat.id;if(!id)return;a.disabled=true;a.innerHTML='<span class="spinner"></span>Loading earlier messages…';const sc=$('#scroll');const from=sc?sc.scrollHeight-sc.scrollTop:0;
 await Chat.loadHistory(id,true);if(sc)requestAnimationFrame(()=>{sc.scrollTop=sc.scrollHeight-from})};

// People › Share an agent (a quick pick of the agent, then its Edit agent › Sharing tab with this person picked) and Change
ACT['ppl-share-open']=a=>ACT['agent-share'](a.dataset.a);
ACT['ppl-share']=a=>{const list=(Pages._agents||[]).filter(n=>!n.includes('--'));menu(a,[{header:'Share which agent?'},...list.map(n=>({label:ident(n).name,icon:'user',ava:agentAvatar(n,20,{title:false}),run:()=>ACT['agent-share'](n,{add:a.dataset.id})}))],{matchWidth:true})};

ACT['sign-out-all']=()=>signOutAll();
