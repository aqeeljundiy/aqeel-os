/* ---------- Agents › Edit agent (agreed layout, 18 Oct): one window with tabs instead of seven menu items.
   Identity     picture (a photo or an emoji), name, title, description (or have it written), and the rarely used extras
   Personality  how it introduces itself and its standing instructions (SOUL)
   Sharing      who owns it and who may use it (the owner only), the one place sharing is changed
   Its model is one line on Identity, "Model: X · Change", which opens Models › Agents' models, the one place an agent's
   model is set (1 Nov 2026: it was a second picker here, written another way, and the two could disagree).
   Save stores whatever changed. The card menu keeps only Edit, Chat with it and Delete; what a member may
   do still follows their share level and permissions. ---------- */
const AE_TABS=['Identity','Personality','History','Abilities','Sharing','Access'];   // Abilities: AdsPower and Composio per agent (admins, optins-page.js)   // Access: which agents may look after this one (agent-access.mjs)
async function editAgent(name,start='Identity',opt={}){
 const base='/profiles/'+encodeURIComponent(name),prof=(Pages._profiles||[]).find(p=>p.name===name)||{name},id=ident(name);
 const admin=S.me?.admin!==false,lvl=admin?'owner':(S.me?.agents?.[name]||'chat'),has=k=>admin||(S.me?.caps||[]).includes(k);
 const owner=admin||Pages._own?.[name]?.access==='owner';   // admins share any agent, as on People
 const tabsOn=AE_TABS.filter(t=>(!['Sharing','Access'].includes(t)||owner)&&(t!=='Abilities'||admin));if(!tabsOn.includes(start))start='Identity';
 const soulR=await H(base+'/soul').catch(()=>null);
 // a SOUL that could not be read is never written back: an empty box would replace the whole personality
 const soulOk=typeof soulR?.content==='string',soul=soulOk?soulR.content:'';
 let newPic=null,removePic=false,emo=id.avatar?null:id.emoji;if(!soulOk&&start==='Personality')start='Identity';
 const sec=(t,html)=>`<div class="ae-sec" data-sec="${t}" ${t===start?'':'hidden'}>${html}</div>`;
 const d=drawer('Edit '+id.name,`<div class="tabs ae-tabs" style="display:flex;margin:0 0 16px">${tabsOn.map(t=>`<button type="button" class="${t===start?'on':''}" data-ae="${t}"${t==='Personality'&&!soulOk?' disabled title="Its personality could not be loaded. Close and open again to edit it."':''}>${t}</button>`).join('')}<span class="pill"></span></div>
  ${sec('Identity',`<div class="ident-top"><div id="idAva" class="ident-ava-box">${agentAvatar(name,84,{cls:'ident-ava',title:false})}</div><div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="idPick">${icon('upload',15)}Upload photo</button><button type="button" class="ghost" id="idDrop" ${id.avatar?'':'hidden'}>Remove photo</button></div><p class="hint" style="margin:6px 0 0">JPG, PNG or WebP. You place it in the circle next. Or pick an emoji below.</p></div></div>
   <div class="ava-crop" id="idCrop"></div><div id="idEmoBox"${EMOJI.length?'':' hidden'}></div>
   <label>Name</label><input id="idName" maxlength="60" value="${esc(id.name)}" placeholder="aqeelOS">
   <label>Title</label><input id="idTitle" maxlength="80" value="${esc(id.title)}" placeholder="Operations assistant">
   <label class="h-row">Description <button type="button" class="ghost" id="aeAuto" style="min-height:28px;padding:0 10px;font-size:12.5px">${icon('sparkle',13)}Write it for me</button></label><input id="idDesc" value="${esc(prof.description||'')}" placeholder="What this agent is for">
   ${has('models')?modelLine(name,prof.model,'id="aeModelGo"'):''}
   ${admin?`<details class="ae-adv"><summary>Advanced</summary><p class="hint">Internal name: <code>${esc(name)}</code> (never changes).</p>
    ${prof.path?`<p class="hint ae-path">Folder on the box: <code>${esc(hideEngine(prof.path))}</code><button type="button" class="ghost icon" data-act="copy-text" data-text="${esc(prof.path)}" aria-label="Copy the folder" title="Copy the folder">${icon('copy',14)}</button></p>`:''}
    <p class="hint">Shortcut command on the box: ${prof.has_alias?'yes':'no'} · Own key file: ${prof.has_env?'yes':'no'}${prof.distribution_name?' · Installed from '+esc(prof.distribution_name)+(prof.distribution_version?' '+esc(prof.distribution_version):''):''}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="ghost" id="aeCmd">${icon('copy',14)}Copy setup command</button><button type="button" class="ghost" id="aeActive">${icon('check',14)}Use on the command line</button></div></details>`:''}`)}
  ${soulOk?'':`<p class="hint" style="margin:0 0 12px">Its personality could not be loaded, so it stays as it is. Close and open again to edit it.</p>`}
  ${soulOk?sec('Personality',`<label style="display:flex;align-items:center;justify-content:space-between;gap:12px">Update how it introduces itself ${toggle(true,'Update introduction','id="idIntro"')}</label><p class="hint">Rewrites the first line so it always calls itself by its name.</p>
   <label>Personality and standing instructions</label><p class="hint ih-flaghint" id="aeFlagHint" hidden></p><textarea id="idSoul" rows="16" style="font-size:12.5px;line-height:1.55">${esc(soul)}</textarea>
   <label>What changed and why <span class="hint">(optional, kept in its history)</span></label><input id="aeWhy" maxlength="300" placeholder="For example: comments 5 an hour instead of 3">`):''}
  ${sec('History',`<div id="aeChg"></div><div id="aeHist">${skeleton(3)}</div>`)}
  ${tabsOn.includes('Abilities')?sec('Abilities',`<p class="hint" style="margin:0 0 12px">Extras ${esc(id.name)} gets only when it needs them. Off, it has none of their tools and nothing asks it to sign in. Each switch saves at once.</p><div id="aeAbil">${skeleton(2)}</div>`):''}
  ${tabsOn.includes('Sharing')?sec('Sharing',`<p class="hint" style="margin:0 0 12px">Who owns ${esc(id.name)} and who else may chat with it or change it. Each change here saves as you make it.</p><div id="aeShareBox">${skeleton(2)}</div>`):''}
  ${tabsOn.includes('Access')?sec('Access',`<p class="hint" style="margin:0 0 12px">Other agents that may look after ${esc(id.name)}. Viewer reads its setup and logs; Editor also changes its instructions, skills and schedules; Manager also its settings and who else may look after it. Its keys are never shared this way. The main agent can always do everything.</p><div id="aeAccessBox">${skeleton(2)}</div>`):''}`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="aeSave">Save</button>`,{size:'lg'});
 // tabs inside the window
 // each tab has its own height, and the window grows or shrinks to it smoothly (no jump, no tall empty space); on
 // Sharing, which saves each change at once, the footer says Done unless another tab has unsaved changes
 const show=t=>{const body=d.querySelector('.drawer-body'),h1=body?.offsetHeight||0;
  d.querySelectorAll('[data-ae]').forEach(b=>b.classList.toggle('on',b.dataset.ae===t));d.querySelectorAll('.ae-sec').forEach(s=>s.hidden=s.dataset.sec!==t);placePills();
  if(body&&h1&&!matchMedia('(prefers-reduced-motion: reduce)').matches){clearTimeout(body._ht);body.style.transition='none';body.style.height='';const h2=body.offsetHeight;
   if(Math.abs(h2-h1)>2){body.style.height=h1+'px';void body.offsetHeight;body.style.transition='height .24s cubic-bezier(.2,.7,.2,1)';body.style.height=h2+'px';body._ht=setTimeout(()=>{body.style.height='';body.style.transition=''},280)}}
  const sv=d.querySelector('#aeSave'),cx=d.querySelector('.drawer-foot [data-act=close]'),only=(t==='Sharing'||t==='Access'||t==='Abilities')&&!isDirty?.();if(sv)sv.hidden=only;if(cx){cx.textContent=only?'Done':'Cancel';cx.classList.toggle('primary',only);cx.classList.toggle('ghost',!only)}};
 let isDirty=null;
 if(tabsOn.includes('Abilities')&&typeof abilitiesTab==='function')abilitiesTab(d.querySelector('#aeAbil'),name);
 d.querySelectorAll('[data-ae]').forEach(b=>b.onclick=()=>{show(b.dataset.ae);if(b.dataset.ae==='History')avChanges(d.querySelector('#aeChg'),name);if(b.dataset.ae==='History')instrHistory(d.querySelector('#aeHist'),name,()=>{closeLayers();editAgent(name,'History')})});
 if(start==='History')avChanges(d.querySelector('#aeChg'),name);if(start==='History')instrHistory(d.querySelector('#aeHist'),name,()=>{closeLayers();editAgent(name,'History')});
 UI('/ui/instructions/'+encodeURIComponent(name)).then(h=>{const el=d.querySelector('#aeFlagHint');if(!el||!d.isConnected)return;const n=(h.flags||[]).length,w=(h.proposals||[]).length;
  if(!n&&!w)return;el.hidden=false;el.innerHTML=icon('alert',13)+' '+[n?n+(n===1?' thing disagrees':' things disagree')+' in these instructions':'',w?w+' rewrite'+(w===1?' waits':'s wait')+' for approval':''].filter(Boolean).join(' · ')+'. <button type="button" class="linkish" id="aeToHist">See History</button>';
  el.querySelector('#aeToHist').onclick=()=>{show('History');instrHistory(d.querySelector('#aeHist'),name,()=>{closeLayers();editAgent(name,'History')})}}).catch(()=>{});requestAnimationFrame(placePills);
 const soulBox=d.querySelector('#idSoul'),intro=d.querySelector('#idIntro'),ava=d.querySelector('#idAva'),nameIn=d.querySelector('#idName'),titleIn=d.querySelector('#idTitle');
 // the introduction line follows the name, but only once the name or title is actually changed: opening and saving
 // the window never rewrites the personality on its own
 const renamed=()=>nameIn.value.trim()!==id.name||titleIn.value.trim()!==(id.title||'');
 const preview=()=>{if(!soulBox)return;soulBox.value=intro.checked&&renamed()?withIntro(soulBox.dataset.base,nameIn.value.trim()||'aqeelOS',titleIn.value.trim()):soulBox.dataset.base};
 if(soulBox){soulBox.dataset.base=soul;soulBox.oninput=()=>{soulBox.dataset.base=soulBox.value};intro.onchange=preview}
 nameIn.oninput=preview;titleIn.oninput=preview;
 // picture: a photo and an emoji replace each other. emo is '' (automatic), a slug, or null while a photo stands
 const drop=d.querySelector('#idDrop'),pickBtn=d.querySelector('#idPick'),initEmo=emo;let blob='';
 const paintAva=()=>{const photo=newPic?blob:emo===null&&!removePic?id.avatar:'';ava.innerHTML=avaHtml(photo||emojiSrc(emo||emojiAuto(name)),!!photo,84,nameIn.value.trim()||id.name,'','ident-ava ava-in');drop.hidden=!photo;setEmo(photo?null:emo)};
 const setEmo=EMOJI.length?emojiPicker(d.querySelector('#idEmoBox'),{cur:emo,auto:emojiAuto(name),label:'Or an emoji',onPick:e=>{emo=e;newPic=null;removePic=!!id.avatar;paintAva()}}):()=>{};
 pickBtn.onclick=()=>pickFile(AVA_ACCEPT,async f=>{pickBtn.disabled=true;const b=await avatarCrop(d.querySelector('#idCrop'),f);pickBtn.disabled=false;if(!b)return;
  if(blob)URL.revokeObjectURL(blob);newPic=b;blob=URL.createObjectURL(b);removePic=false;emo=null;paintAva()});
 drop.onclick=()=>{newPic=null;removePic=!!id.avatar;if(emo===null)emo=initEmo===null?'':initEmo;paintAva()};   // back to its emoji (automatic if it had a photo)
 const emoChanged=()=>emo!==null&&emo!==initEmo;
 isDirty=()=>renamed()||soulBox&&soulBox.value!==soul||newPic||removePic||emoChanged()||d.querySelector('#idDesc').value.trim()!==(prof.description||'');if(start==='Sharing')show('Sharing');
 paintAva();
 d.querySelector('#aeAuto').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const r=await post(H,base+'/describe-auto',{overwrite:true});if(r.description){d.querySelector('#idDesc').value=r.description;prof.description=r.description}toast('Description written and saved')}catch(er){fail(er)}b.disabled=false};
 d.querySelector('#aeCmd')?.addEventListener('click',async()=>{try{const r=await H(base+'/setup-command');await copyText(r.command,'Copied: '+r.command)}catch(e){fail(e)}});
 d.querySelector('#aeActive')?.addEventListener('click',async()=>{try{await post(H,'/profiles/active',{name});(S.profile||'default')===name?toast('The command line now uses '+id.name):toastDo('The command line now uses '+id.name,'Manage it here too',()=>{closeLayers();switchAgent(name)})}catch(e){fail(e)}});
 // its model: from the Agents list when loaded, else read now (opened from People before Agents, it said "Not set yet")
 if(has('models')&&prof.model===undefined)H('/model/info?profile='+encodeURIComponent(name)).then(i=>{if(d.isConnected)modelLinesSay(name,i?.model||'')}).catch(()=>{});
 // admins: Change leaves this window for Models › Agents' models, so warn before unsaved edits are lost; a member picks in place
 d.querySelector('#aeModelGo')?.addEventListener('click',async e=>{const b=e.currentTarget;if(S.me?.admin===false)return ACT['model-change'](b);if(isDirty()&&!await confirmBox('Leave without saving?','Your changes to this agent are not saved yet.','Leave'))return;ACT['model-change'](b)});
 // sharing is drawn right in its tab and saves each change at once (shareInto, people.js)
 const shareBox=d.querySelector('#aeShareBox');if(shareBox)shareInto(shareBox,name,opt);
 const accBox=d.querySelector('#aeAccessBox');if(accBox)agentAccessInto(accBox,name);
 d.querySelector('#aeSave').onclick=async()=>{const nm=nameIn.value.trim();if(!nm){show('Identity');return toast('Give it a name','err')}const btn=d.querySelector('#aeSave');btn.disabled=true;
  try{if(nm!==id.name||titleIn.value.trim()!==id.title||emoChanged())await call('','/ui/identities/'+encodeURIComponent(name),{method:'PUT',body:{name:nm,title:titleIn.value.trim(),...(emoChanged()?{emoji:emo}:{})}});   // an emoji also clears the photo on the server
   if(newPic)await call('','/ui/avatar/'+encodeURIComponent(name),{method:'PUT',headers:{'content-type':newPic.type},body:newPic});   // through call(): the shared reads are dropped, so the old picture can't come back
   if(removePic&&!emo)await call('','/ui/avatar/'+encodeURIComponent(name),{method:'DELETE'});
   const desc=d.querySelector('#idDesc').value.trim();if(desc!==(prof.description||''))await put(H,base+'/description',{description:desc});
   if(soulOk&&soulBox&&soulBox.value!==soul)await call('','/ui/instructions/'+encodeURIComponent(name)+'/save',{method:'PUT',body:{content:soulBox.value,why:d.querySelector('#aeWhy')?.value.trim()||''}});   // saved as a version with who and why (History)
   await loadIdentities();closeLayers();toast(nm+' saved');repaintAvatars(name);paintSide();if(route().page?.id==='profiles')reload()}   // its avatar changes in place everywhere on screen
  catch(e){fail(e);btn.disabled=false}}}
// the card menu: Edit, Chat with it, Delete (each only when allowed)
{const full=Pages.profileMenu;
 Pages.profileMenu=el=>{const n=el.dataset.name,x=(Pages._profiles||[]).find(p=>p.name===n)||{};const admin=S.me?.admin!==false;
  const lvl=admin?'owner':(S.me?.agents?.[n]||'chat');
  // Delete keeps its own careful confirmation: take it from the full menu
  let del=null;const real=window.menu;window.menu=(a,items)=>{window.menu=real;del=items.find(i=>i&&i.label==='Delete')||null};try{full(el)}catch{window.menu=real}
  menu(el,[...(lvl!=='chat'?[{label:'Edit agent',icon:'edit',run:()=>editAgent(n)}]:[]),{label:'Chat with it',icon:'chat',run:()=>switchAgent(n)},...(!x.is_default&&del?['-',del]:[])])}}
ACT['ident-open']=(a,e)=>{if(e?.target?.closest('[data-menu]'))return;editAgent(a.dataset.name)};
// a toast with one follow-up action (looks like the Undo toast)
function toastDo(msg,label,run){const t=document.createElement('div');t.className='toast undo';t.innerHTML=icon('check',15)+'<span>'+esc(msg)+'</span><button class="ghost small">'+esc(label)+'</button>';$('#toasts').append(t);
 const bye=()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)};const tm=setTimeout(bye,8000);t.querySelector('button').onclick=()=>{clearTimeout(tm);bye();run()}}

/* ---------- Edit agent › History (instructions.mjs): every version of its instructions with who changed what and why
   (its decisions log), rewrites waiting for the owner's approval as before/after, and what disagrees inside them.
   One place for an agent's decisions (owner brief item 11, 5 Nov 2026). ---------- */
const IH_KIND={import:'Old backup file',start:'History started',box:'Changed on the box',edit:'Edited in aqeelOS',agent:'Changed by the agent',approved:'Rewrite approved',restore:'Brought back'};
const ihWhen=t=>{const d=new Date(t);return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
// changed lines with two lines around them; long unchanged stretches fold into one line
function ihDiff(diff){const keep=new Set();diff.forEach((x,i)=>{if(x[0]!==' ')for(let k=i-2;k<=i+2;k++)keep.add(k)});let out='',gap=0;
 const flush=()=>{if(gap)out+=`<div class="ih-gap">${gap} unchanged line${gap===1?'':'s'}</div>`;gap=0};
 diff.forEach((x,i)=>{if(!keep.has(i)){gap++;return}flush();out+=`<div class="ih-l ${x[0]==='+'?'ih-add':x[0]==='-'?'ih-del':''}"><span class="ih-m">${x[0]==='+'?'+':x[0]==='-'?'−':''}</span><span>${esc(x[1])||'&nbsp;'}</span></div>`});flush();
 return out?`<div class="ih-diff"><div class="ih-key"><span class="ih-k-del">Before</span><span class="ih-k-add">After</span></div>${out}</div>`:'<p class="hint">No changes.</p>'}
async function instrHistory(box,name,reopen){if(!box)return;const base='/ui/instructions/'+encodeURIComponent(name);let h;
 try{h=await UI(base)}catch(e){box.innerHTML=`<p class="hint">${esc(e.message||'Could not load the history.')}</p>`;return}if(!box.isConnected)return;
 const admin=S.me?.admin!==false,mayDecide=admin||S.me?.agents?.[name]==='owner';
 const props=(h.proposals||[]).map(p=>`<div class="panel ih-prop" data-p="${esc(p.id)}"><div class="ih-row"><b>${icon('alert',15)} New instructions wait for ${mayDecide?'your':'the owner’s'} approval</b><span class="ih-n"><span class="ih-plus">+${p.added}</span> <span class="ih-minus">−${p.removed}</span></span></div>
   <p class="ih-why">${esc(p.why||'No reason given')}</p><p class="hint">${esc(p.by||'Someone')}${p.said?' · decided by '+esc(p.said):''} · ${ihWhen(p.at)}</p>
   <div class="ih-acts"><button type="button" class="ghost small" data-act="ih-review">Show before and after</button>${mayDecide?`<button type="button" class="ghost small" data-act="ih-no">Decline</button><button type="button" class="primary small" data-act="ih-yes">Approve</button>`:''}</div><div class="ih-body" hidden></div></div>`).join('');
 const flags=h.flags||[];
 const flagHtml=`<div class="panel ih-flags"><div class="ih-row"><b class="${flags.length?'':'ih-ok'}">${flags.length?icon('alert',15)+' '+flags.length+(flags.length===1?' thing disagrees':' things disagree'):icon('check',15)+' Nothing disagrees'}</b><button type="button" class="ghost small" data-act="ih-check"${h.checking?' disabled':''}>${h.checking?'Checking…':'Check again'}</button></div>
  ${flags.length?flags.map(f=>`<div class="ih-flag"><p><b>${esc(f.title)}</b></p>${f.detail?`<p class="hint">${esc(f.detail)}</p>`:''}<ul>${(f.quotes||[]).map(q=>`<li>${q.value?'<b>'+esc(q.value)+'</b>: ':''}“${esc(q.quote)}” <span class="hint">(${q.where==='memory'?'in its memory':'in its instructions'})</span></li>`).join('')}</ul></div>`).join(''):`<p class="hint">Its instructions and memory were checked for one rule with two values${h.checkedAt?' · '+ihWhen(h.checkedAt):''}.</p>`}</div>`;
 const vers=h.versions||[],latest=vers[0]?.v;
 const list=vers.map(v=>`<div class="ih-ver" data-v="${v.v}"><button type="button" class="ih-head" data-act="ih-open" aria-expanded="false"><span class="ih-vn">${v.v}</span><span class="ih-t"><b>${esc(v.why||IH_KIND[v.kind]||'Changed')}</b><small>${esc(IH_KIND[v.kind]||v.kind)} · ${esc(v.by||'')}${v.said?' · decided by '+esc(v.said):''}${v.approvedBy?' · approved by '+esc(v.approvedBy):''} · ${ihWhen(v.at)}</small></span><span class="ih-n"><span class="ih-plus">+${v.added}</span> <span class="ih-minus">−${v.removed}</span></span></button><div class="ih-body" hidden></div></div>`).join('');
 box.innerHTML=`${props}${flagHtml}<p class="hint" style="margin:14px 0 8px">Every change to its instructions, newest first: who made it, when and why. This is where its decisions live.</p><div class="ih-list">${list||'<p class="hint">No history yet.</p>'}</div>`;
 const busy=b=>{b.disabled=true;return()=>{b.disabled=false}};
 box.querySelector('[data-act="ih-check"]')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Checking…';try{await post(UI,base+'/check');instrHistory(box,name,reopen)}catch(er){fail(er);b.disabled=false;b.textContent='Check again'}});
 box.querySelectorAll('.ih-prop').forEach(card=>{const id=card.dataset.p,body=card.querySelector('.ih-body');
  card.querySelector('[data-act="ih-review"]').onclick=async e=>{const b=e.currentTarget;if(!body.hidden){body.hidden=true;b.textContent='Show before and after';return}const done=busy(b);
   try{const p=await UI(base+'/p/'+encodeURIComponent(id));body.innerHTML=(p.changedSince?'<p class="hint">Its instructions changed after this was written. Approving replaces those changes too (they stay in the history).</p>':'')+ihDiff(p.diff);body.hidden=false;b.textContent='Hide before and after'}catch(er){fail(er)}done()};
  card.querySelector('[data-act="ih-yes"]')?.addEventListener('click',async e=>{const done=busy(e.currentTarget);try{const r=await post(UI,base+'/decide',{id,ok:true});toast('Approved. It is version '+(r.version?.v||'')+' and applies from its next message');reopen()}catch(er){fail(er);done()}});
  card.querySelector('[data-act="ih-no"]')?.addEventListener('click',async e=>{if(!await confirmBox('Decline these instructions?','Nothing changes. The agent keeps its current instructions.','Decline'))return;const done=busy(e.currentTarget);try{await post(UI,base+'/decide',{id,ok:false});toast('Declined');reopen()}catch(er){fail(er);done()}})});
 box.querySelectorAll('.ih-ver').forEach(row=>{const v=+row.dataset.v,body=row.querySelector('.ih-body'),head=row.querySelector('.ih-head');
  head.onclick=async()=>{const open=body.hidden;head.setAttribute('aria-expanded',String(open));row.classList.toggle('open',open);if(!open){body.hidden=true;return}
   if(!body.dataset.done){body.innerHTML=skeleton(2);body.hidden=false;try{const x=await UI(base+'/v/'+v);body.innerHTML=ihDiff(x.diff)+(v!==latest?`<div class="ih-acts"><button type="button" class="ghost small" data-act="ih-restore">${icon('retry',14)}Bring this version back</button></div>`:'');body.dataset.done='1';
     body.querySelector('[data-act="ih-restore"]')?.addEventListener('click',async e=>{if(!await confirmBox('Bring back version '+v+'?','Its instructions become this version again. Today’s stays in the history, so you can go back.','Bring it back',false))return;const done=busy(e.currentTarget);try{await post(UI,base+'/restore',{v});toast('Version '+v+' is back');reopen()}catch(er){fail(er);done()}})}catch(er){body.innerHTML=`<p class="hint">${esc(er.message)}</p>`}}
   body.hidden=false}})}

// Agents › Edit agent › Access: one row per other agent with its level on this one; each change saves at once
const ACC_LABEL={none:'No access',viewer:'Viewer',editor:'Editor',manager:'Manager'};
async function agentAccessInto(box,name){let r;try{r=await UI('/ui/agent-access?agent='+encodeURIComponent(name))}catch(e){if(box.isConnected)box.innerHTML=errLine('who may look after this agent');return}if(!box.isConnected)return;
 const ro=S.me?.admin===false;
 box.innerHTML=r.agents.map(a=>`<div class="pshare">${agentAvatar(a.id,28,{title:false})}<b>${esc(ident(a.id).name||a.name)}</b><select style="width:auto;margin-left:auto" data-acc="${esc(a.id)}" aria-label="What ${esc(a.name)} may do" ${ro?'disabled':''}>${Object.entries(ACC_LABEL).map(([k,v])=>`<option value="${k}" ${(r.grants[a.id]||'none')===k?'selected':''}>${v}</option>`).join('')}</select></div>`).join('')||'<p class="hint">There are no other agents.</p>';
 box.querySelectorAll('select').forEach(s=>typeof enhanceSelect==='function'&&enhanceSelect(s));
 box.querySelectorAll('[data-acc]').forEach(s=>s.onchange=async()=>{s.disabled=true;try{await post(UI,'/ui/agent-access',{agent:name,to:s.dataset.acc,level:s.value});toast(s.value==='none'?'No longer shared':'Saved')}catch(e){fail(e)}agentAccessInto(box,name)})}

/* An agent's own changes (agent-versions.mjs, 6 Nov 2026): skills, schedules, settings and webhooks it changed itself,
   each with Undo; automatic rollbacks when it stopped answering. Its instructions keep their own history below. */
const AV_KIND={skill:'Skill',schedule:'Schedule',setting:'Setting',webhook:'Webhook',instructions:'Instructions'};
async function avChanges(box,name){if(!box)return;let c;try{c=await UI('/ui/agent-versions/'+encodeURIComponent(name))}catch(e){box.innerHTML='';return}if(!box.isConnected)return;
 const items=(c.items||[]).filter(x=>x.kind!=='instructions'),rb=(c.events||[]).filter(e=>e.kind==='rollback');
 if(!items.length&&!rb.length&&!c.watch){box.innerHTML='';return}
 box.innerHTML=`<div class="panel" style="margin:0 0 14px"><div class="ih-row"><b>Changes it made to itself</b>${c.watch?'<span class="hint">Checking it still answers…</span>':''}</div>
  ${rb.map(e=>`<p class="hint">${icon('alert',13)} ${esc(e.text)} <span class="hint">(${ihWhen(e.at)})</span></p>`).join('')}
  <p class="hint" style="margin:6px 0 8px">Its own skills, schedules, settings and webhooks, newest first. If it stops answering after a change, aqeelOS undoes its recent changes by itself.</p>
  ${items.map(x=>`<div class="ih-row" data-av="${esc(x.id)}" style="padding:6px 0;border-top:1px solid var(--line,#eee)"><span><b>${esc(AV_KIND[x.kind]||x.kind)}</b> · ${esc(x.what)}${x.why?' <span class="hint">— '+esc(x.why)+'</span>':''}<br><small class="hint">${esc(x.by||'')} · ${ihWhen(x.at)}${x.state==='undone'?' · undone by '+esc(x.undoneBy||'')+' '+ihWhen(x.undoneAt):''}</small></span>${x.state==='done'&&x.undoable?'<button type="button" class="ghost small" data-act="av-undo">Undo</button>':''}</div>`).join('')}</div>`;
 box.querySelectorAll('[data-act="av-undo"]').forEach(b=>b.onclick=async()=>{const id=b.closest('[data-av]').dataset.av;b.disabled=true;b.textContent='Undoing…';
  try{await post(UI,'/ui/agent-versions/'+encodeURIComponent(name)+'/undo',{id});avChanges(box,name)}catch(er){fail(er);b.disabled=false;b.textContent='Undo'}})}
