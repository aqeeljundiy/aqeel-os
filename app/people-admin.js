/* People: what an admin does for someone locked out or leaving (7 Nov 2026). A new password (they are signed out
   everywhere), sign them out, turn their two-step off, suspend them. Expired invites renew from Waiting to join, and
   the owner makes a recovery code in their profile. Server: users.mjs (/ui/people/<id>/…). */
const PeopleAdmin={
 items(u){const id=encodeURIComponent(u.id),go=async(path,body,msg)=>{try{await post(UI,'/ui/people/'+id+'/'+path,body);toast(msg);reload()}catch(e){fail(e)}};
  return [{label:'Set a new password',icon:'key',run:()=>PeopleAdmin.password(u)},
   {label:u.email?'Change sign-in email':'Add sign-in email',icon:'mail',run:async()=>{const em=await promptBox((u.email?'Change':'Add')+' '+u.name+'’s sign-in email','Email',u.email||'',u.email?'Change':'Add','email');if(em==null||!em.trim())return;go('email',{email:em.trim()},u.name+' signs in with '+em.trim().toLowerCase())}},
   {label:'Sign out everywhere',icon:'logout',run:async()=>{if(await confirmBox('Sign '+u.name+' out everywhere?','Every browser and phone signed in as '+u.name+' is signed out. They can sign in again with their password.','Sign out',false))go('signout',{},u.name+' is signed out everywhere')}},
   ...(u.twoStep?[{label:'Turn off two-step',icon:'shield',run:async()=>{if(await confirmBox('Turn off two-step for '+u.name+'?','They sign in with their password only, until they turn it on again in their profile. Use it when they lost access to their email.','Turn off',false))go('two-step-off',{},'Two-step is off for '+u.name)}}]:[]),
   u.disabled?{label:'Let them sign in again',icon:'unlock',run:()=>go('suspend',{on:false},u.name+' can sign in again')}
    :{label:'Suspend',icon:'lock',run:async()=>{if(await confirmBox('Suspend '+u.name+'?','They are signed out and can’t sign in until you let them again. Their agents, chats and files stay as they are.','Suspend'))go('suspend',{on:true},u.name+' is suspended')}}]},
 // a small dialog: the new password (shown or hidden), and two-step off when they have it on
 password(u){const {d,close}=stackPop('New password for '+u.name,`<label for="pa-pw">New password</label><div class="pw-wrap"><input id="pa-pw" type="password" autocomplete="new-password" placeholder="At least 8 characters" spellcheck="false"><button type="button" class="ghost icon pw-eye" aria-label="Show password" title="Show password">${icon('eye',16)}</button></div>
   ${u.twoStep?'<label class="pick" style="display:flex;gap:10px;align-items:center;margin-top:12px"><input type="checkbox" id="pa-2s" checked><span>Also turn off two-step sign-in</span></label>':''}
   <p class="hint" style="margin:10px 0 0">They are signed out everywhere. Tell them the new password yourself; they can change it in their profile.</p><p id="pa-err" role="alert" style="margin:8px 0 0;min-height:1.2em;font-size:13px;color:var(--bad)"></p>`,
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="pa-go">Set password</button>`);
  const i=d.querySelector('#pa-pw'),eye=d.querySelector('.pw-eye'),b=d.querySelector('#pa-go');setTimeout(()=>i.focus(),80);let busy=false;
  eye.onclick=()=>{const s=i.type==='password';i.type=s?'text':'password';eye.setAttribute('aria-label',s?'Hide password':'Show password');i.focus()};
  const save=async()=>{if(busy)return;if(i.value.length<8){d.querySelector('#pa-err').textContent='Use at least 8 characters.';return}busy=true;b.disabled=true;b.classList.add('is-busy');
   try{await post(UI,'/ui/people/'+encodeURIComponent(u.id)+'/password',{password:i.value,twoStepOff:!!d.querySelector('#pa-2s')?.checked});close();toast('New password set for '+u.name);reload()}
   catch(e){d.querySelector('#pa-err').textContent=e.message||'It could not be saved.'}finally{busy=false;if(b.isConnected){b.disabled=false;b.classList.remove('is-busy')}}};
  b.onclick=e=>{e.stopPropagation();save()};i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();save()}}}};
ACT['ppl-renew']=async a=>{a.disabled=true;a.classList.add('is-busy');try{await post(UI,'/ui/people/invite/'+encodeURIComponent(a.dataset.code)+'/renew');await copyInvite(a.dataset.code);reload()}catch(e){fail(e);a.disabled=false;a.classList.remove('is-busy')}};
// the owner's recovery code: asks for the password, then shows the new code once
ACT['me-recovery']=async()=>{const pw=await promptBox('Make a recovery code','Your current password','','Continue','password');if(pw==null)return;
 try{const r=await post(UI,'/ui/me/recovery',{current:pw});S.me&&(S.me.recovery=true);
  const {d}=stackPop('Your recovery code',`<p style="margin:0 0 12px;color:var(--ink-2);line-height:1.55">Save it somewhere safe, like a password manager. It signs you in once if you lose your password or email. The old code no longer works.</p><div class="rc-box"><code>${esc(r.code)}</code><button type="button" class="ghost small" id="rc-copy">${icon('copy',15)}Copy</button></div>`,`<button class="primary" data-x>Done</button>`);
  d.querySelector('#rc-copy').onclick=async e=>{const ok=await copyText(r.code,'');e.currentTarget.innerHTML=icon(ok?'check':'copy',15)+(ok?'Copied':'Copy')}}catch(e){fail(e)}};
