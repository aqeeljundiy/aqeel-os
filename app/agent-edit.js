/* ---------- Agents › Edit agent (agreed layout, 18 Oct): one window with tabs instead of seven menu items.
   Identity     picture (a photo or an emoji), name, title, description (or have it written), and the rarely used extras
   Personality  how it introduces itself and its standing instructions (SOUL)
   Sharing      who owns it and who may use it (the owner only), the one place sharing is changed
   Its model is one line on Identity, "Model: X · Change", which opens Models › Agents' models, the one place an agent's
   model is set (1 Nov 2026: it was a second picker here, written another way, and the two could disagree).
   Save stores whatever changed. The card menu keeps only Edit, Chat with it and Delete; what a member may
   do still follows their share level and permissions. ---------- */
const AE_TABS=['Identity','Personality','Sharing'];
async function editAgent(name,start='Identity',opt={}){
 const base='/profiles/'+encodeURIComponent(name),prof=(Pages._profiles||[]).find(p=>p.name===name)||{name},id=ident(name);
 const admin=S.me?.admin!==false,lvl=admin?'owner':(S.me?.agents?.[name]||'chat'),has=k=>admin||(S.me?.caps||[]).includes(k);
 const owner=admin||Pages._own?.[name]?.access==='owner';   // admins share any agent, as on People
 const tabsOn=AE_TABS.filter(t=>t!=='Sharing'||owner);if(!tabsOn.includes(start))start='Identity';
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
   <label>Personality and standing instructions</label><textarea id="idSoul" rows="16" style="font-size:12.5px;line-height:1.55">${esc(soul)}</textarea>`):''}
  ${tabsOn.includes('Sharing')?sec('Sharing',`<p class="hint" style="margin:0 0 12px">Who owns ${esc(id.name)} and who else may chat with it or change it. Changes here save at once.</p><div id="aeShareBox">${skeleton(2)}</div>`):''}`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="aeSave">Save</button>`,{size:'lg'});
 // tabs inside the window
 const show=t=>{d.querySelectorAll('[data-ae]').forEach(b=>b.classList.toggle('on',b.dataset.ae===t));d.querySelectorAll('.ae-sec').forEach(s=>s.hidden=s.dataset.sec!==t);placePills()};
 d.querySelectorAll('[data-ae]').forEach(b=>b.onclick=()=>show(b.dataset.ae));requestAnimationFrame(placePills);
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
 paintAva();
 d.querySelector('#aeAuto').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const r=await post(H,base+'/describe-auto',{overwrite:true});if(r.description){d.querySelector('#idDesc').value=r.description;prof.description=r.description}toast('Description written and saved')}catch(er){fail(er)}b.disabled=false};
 d.querySelector('#aeCmd')?.addEventListener('click',async()=>{try{const r=await H(base+'/setup-command');await copyText(r.command,'Copied: '+r.command)}catch(e){fail(e)}});
 d.querySelector('#aeActive')?.addEventListener('click',async()=>{try{await post(H,'/profiles/active',{name});(S.profile||'default')===name?toast('The command line now uses '+id.name):toastDo('The command line now uses '+id.name,'Manage it here too',()=>{closeLayers();switchAgent(name)})}catch(e){fail(e)}});
 // its model: from the Agents list when loaded, else read now (opened from People before Agents, it said "Not set yet")
 if(has('models')&&prof.model===undefined)H('/model/info?profile='+encodeURIComponent(name)).then(i=>{if(d.isConnected)modelLinesSay(name,i?.model||'')}).catch(()=>{});
 // admins: Change leaves this window for Models › Agents' models, so warn before unsaved edits are lost; a member picks in place
 d.querySelector('#aeModelGo')?.addEventListener('click',async e=>{const b=e.currentTarget;if(S.me?.admin===false)return ACT['model-change'](b);const dirty=renamed()||soulBox&&soulBox.value!==soul||newPic||removePic||emoChanged()||d.querySelector('#idDesc').value.trim()!==(prof.description||'');if(dirty&&!await confirmBox('Leave without saving?','Your changes to this agent are not saved yet.','Leave'))return;ACT['model-change'](b)});
 // sharing is drawn right in its tab and saves each change at once (shareInto, people.js)
 const shareBox=d.querySelector('#aeShareBox');if(shareBox)shareInto(shareBox,name,opt);
 d.querySelector('#aeSave').onclick=async()=>{const nm=nameIn.value.trim();if(!nm){show('Identity');return toast('Give it a name','err')}const btn=d.querySelector('#aeSave');btn.disabled=true;
  try{if(nm!==id.name||titleIn.value.trim()!==id.title||emoChanged())await call('','/ui/identities/'+encodeURIComponent(name),{method:'PUT',body:{name:nm,title:titleIn.value.trim(),...(emoChanged()?{emoji:emo}:{})}});   // an emoji also clears the photo on the server
   if(newPic)await call('','/ui/avatar/'+encodeURIComponent(name),{method:'PUT',headers:{'content-type':newPic.type},body:newPic});   // through call(): the shared reads are dropped, so the old picture can't come back
   if(removePic&&!emo)await call('','/ui/avatar/'+encodeURIComponent(name),{method:'DELETE'});
   const desc=d.querySelector('#idDesc').value.trim();if(desc!==(prof.description||''))await put(H,base+'/description',{description:desc});
   if(soulOk&&soulBox&&soulBox.value!==soul)await put(H,base+'/soul',{content:soulBox.value});
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
