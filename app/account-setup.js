/* Getting in without editing a file (7 Nov 2026): the first-run "Create the owner account" screen, "Forgot password"
   (an email link), the owner's recovery code, and the page a reset link opens (/#reset/<token>). Server: account-auth.mjs.
   Each step swaps the sign-in card: the old one fades out, the new one rises in. */
const Acct={
 card(html,after){const box=$('.signin');if(!box)return;const old=box.querySelector('.card');const put=()=>{box.innerHTML=html;const f=box.querySelector('.card');after?.(f)};
  if(!old)return put();old.classList.add('leaving');setTimeout(put,160)},
 head(){return `<span class="wordmark"><img class="mark" src="${Brand.mark()}" alt="">${esc(Brand.name)}</span>`},
 shake(f){f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')},
 async call(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'That did not work. Try again.'),{status:r.status});return d},
 // runs a form: the button is busy while it works, an error shakes the card and says why
 form(f,run){f.onsubmit=async e=>{e.preventDefault();const err=f.querySelector('.err'),b=f.querySelector('button.primary');err.textContent='';b.disabled=true;b.classList.add('is-busy');
  try{await run()}catch(x){err.textContent=x.status?x.message:'Could not reach '+Brand.name+'. Check your connection and try again.';Acct.shake(f)}finally{if(b.isConnected){b.disabled=false;b.classList.remove('is-busy')}}}},
 signedIn(){S.signedIn=true;history.replaceState(null,'','/#/chat');boot()},
 pw(id,label='Password',ph='At least 8 characters',auto='new-password'){return `<label for="${id}">${label}</label><div class="pw-wrap"><input id="${id}" type="password" autocomplete="${auto}" placeholder="${ph}" minlength="8"><button type="button" class="ghost icon pw-eye" data-eye="${id}" aria-label="Show password" title="Show password">${icon('eye',16)}</button></div>`},
 eyes(f){f.querySelectorAll('[data-eye]').forEach(b=>b.onclick=()=>{const i=f.querySelector('#'+b.dataset.eye);const show=i.type==='password';i.type=show?'text':'password';b.setAttribute('aria-label',show?'Hide password':'Show password');b.title=b.getAttribute('aria-label');i.focus()})},

 /* first run: nobody can sign in yet, so the first visit makes the owner */
 setup(){Acct.card(`<form class="card" id="acSetup" novalidate>${Acct.head()}<h1>Create the owner account</h1><p>This is a new install. The owner can do everything and invites the others.</p>
   <label for="acN">Your name</label><input id="acN" autocomplete="name" placeholder="Sam Lee">
   <label for="acE">Email</label><input id="acE" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="sam@example.com"><p class="hint ac-hint">You sign in with this.</p>
   ${Acct.pw('acP')}<p class="err" role="alert"></p><button class="primary" type="submit">Create account</button><p class="foot">${icon('lock',13)} Private · ${esc(location.host)}</p></form>`,f=>{
   Acct.eyes(f);const n=f.querySelector('#acN'),em=f.querySelector('#acE');n.focus();
   Acct.form(f,async()=>{const pw=f.querySelector('#acP').value;if(!n.value.trim())throw Object.assign(new Error('Tell us your name.'),{status:400});if(!/^\S+@\S+\.\S+$/.test(em.value.trim()))throw Object.assign(new Error('Enter your email address. You sign in with it.'),{status:400});if(pw.length<8)throw Object.assign(new Error('Use a password of at least 8 characters.'),{status:400});
    const d=await Acct.call('/auth/setup',{name:n.value.trim(),email:em.value.trim(),password:pw});Acct.showCode(d.recovery,'Your account is ready')})})},

 /* the recovery code, shown once; Continue waits until they say it is saved */
 showCode(code,title){Acct.card(`<form class="card" id="acCode">${Acct.head()}<h1>${esc(title)}</h1><p>Save this recovery code somewhere safe, like a password manager. It signs you in once if you lose your password or your email.</p>
   <div class="rc-box"><code>${esc(code)}</code><button type="button" class="ghost small" data-copy>${icon('copy',15)}Copy</button></div>
   <label class="pick rc-ok"><input type="checkbox" id="acSaved"><span>I saved it</span></label><p class="err" role="alert"></p><button class="primary" type="submit" disabled>Continue</button></form>`,f=>{
   const c=f.querySelector('#acSaved'),b=f.querySelector('button.primary');c.onchange=()=>{b.disabled=!c.checked};
   f.querySelector('[data-copy]').onclick=async e=>{const ok=await copyText(code,'');e.currentTarget.innerHTML=icon(ok?'check':'copy',15)+(ok?'Copied':'Copy')};
   f.onsubmit=e=>{e.preventDefault();if(c.checked)Acct.signedIn()}})},

 /* forgot password: a link to the confirmed email (or the recovery code, for the owner) */
 forgot(){Acct.card(`<form class="card" id="acForgot">${Acct.head()}<h1>Reset your password</h1><p>We email a link to the address confirmed on your account.</p>
   <label for="acW">Email</label><input id="acW" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@example.com">
   <p class="err" role="alert"></p><button class="primary" type="submit">Send reset link</button>
   <p class="ac-links"><button type="button" class="link" data-ac="back">Back to sign in</button><button type="button" class="link" data-ac="code">Use a recovery code</button></p>
   <p class="hint ac-hint">No confirmed email? An admin can set a new password for you under People.</p></form>`,f=>{
   Acct.links(f);const w=f.querySelector('#acW');w.value=$('#nm')?.value||'';w.focus();
   Acct.form(f,async()=>{if(!w.value.trim())throw Object.assign(new Error('Enter your email.'),{status:400});await Acct.call('/auth/forgot',{who:w.value.trim()});
    Acct.card(`<div class="card">${Acct.head()}<h1>Check your email</h1><p>If that account has a confirmed email, a reset link is on its way. It works once, for one hour, and may land in spam.</p><p class="ac-links"><button type="button" class="link" data-ac="back">Back to sign in</button></p></div>`,Acct.links)})})},

 /* the owner's way back in without email: the recovery code, a new password, two-step off */
 recover(){Acct.card(`<form class="card" id="acRec">${Acct.head()}<h1>Use a recovery code</h1><p>For the owner. It sets a new password and turns two-step sign-in off. You get a new code after.</p>
   <label for="acC">Recovery code</label><input id="acC" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE-FGHJK-LMNPQ-RSTUV" class="mono">
   ${Acct.pw('acRP','New password')}<p class="err" role="alert"></p><button class="primary" type="submit">Set password and sign in</button>
   <p class="ac-links"><button type="button" class="link" data-ac="back">Back to sign in</button></p></form>`,f=>{
   Acct.links(f);Acct.eyes(f);f.querySelector('#acC').focus();
   Acct.form(f,async()=>{const d=await Acct.call('/auth/recover',{code:f.querySelector('#acC').value,password:f.querySelector('#acRP').value});Acct.showCode(d.recovery,'You are back in')})})},

 /* /#reset/<token>: the link from the email */
 async reset(root,tok){root.innerHTML='<div class="signin"></div>';let info=null;try{const r=await fetch('/auth/reset?t='+encodeURIComponent(tok));if(r.ok)info=await r.json()}catch{}
  if(!info)return Acct.card(`<div class="card">${Acct.head()}<h1>This link doesn't work</h1><p>It has expired or was already used. Ask for a new one from the sign-in page.</p><div class="ac-btns"><button type="button" class="primary" data-ac="back">Go to sign in</button><button type="button" class="ghost" data-ac="forgot">Send a new link</button></div></div>`,Acct.links);
  Acct.card(`<form class="card" id="acReset">${Acct.head()}<h1>Pick a new password</h1><p>For ${esc(info.name)}${info.username?' (@'+esc(info.username)+')':''}. Every other device signed in as you is signed out.</p>
   ${Acct.pw('acNP','New password')}<p class="err" role="alert"></p><button class="primary" type="submit">Save and sign in</button></form>`,f=>{
   Acct.eyes(f);f.querySelector('#acNP').focus();Acct.form(f,async()=>{await Acct.call('/auth/reset',{t:tok,password:f.querySelector('#acNP').value});Acct.signedIn()})})},

 links(f){f.querySelectorAll('[data-ac]').forEach(b=>b.onclick=()=>{const g=b.dataset.ac;if(g==='forgot')return Acct.forgot();if(g==='code')return Acct.recover();
  if(location.hash.startsWith('#reset/')||location.hash.startsWith('#/reset/'))history.replaceState(null,'','/#signin');Acct.card(signinHtml().replace(/^<div class="signin">|<\/div>$/g,''),()=>bindSignin(true))})}};

// the sign-in page: says this install's name, has "Forgot password?", and turns into the setup screen on a new install
{const html=signinHtml;signinHtml=()=>html().replace('<p>Sign in to aqeelOS.</p>','<p>Sign in to '+esc(Brand.name)+'.</p>')
  .replace('<label for="nm">Username</label><input id="nm" autocomplete="username"','<label for="nm">Email</label><input id="nm" inputmode="email" autocomplete="username"').replace('placeholder="Your username"','placeholder="you@example.com"').replace('<p class="foot">','<p class="ac-links"><button type="button" class="link" data-ac="forgot">Forgot password?</button></p><p class="foot">')}
{const bind=bindSignin;bindSignin=again=>{bind();const f=$('#signin');if(f){Acct.links(f);f.addEventListener('submit',()=>{Acct.typed=$('#nm')?.value.trim()||'';Acct.checked=false},true)}if(again)return;
 fetch('/auth/setup',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.needed&&$('#signin'))Acct.setup()}).catch(()=>{})}}
{const base=render;render=function(){const m=/^#\/?reset\/([\w-]+)/.exec(location.hash);if(m){closeLayers();return Acct.reset($('#root'),m[1])}return base()}}
// a reset link opened while this tab shows the sign-in page (the app's own hash handler only runs when signed in)
// signed out, the pages of their own follow the address too: an invite link pasted into the sign-in tab opened nothing, and
// "Go to sign in" on an expired invite left the person on that page (audit of 12 Nov 2026)
addEventListener('hashchange',()=>{if(!S.signedIn&&/^#\/?(reset|invite|signin)(\/|$)/.test(location.hash))render()});

/* Sign-in is by email (7 Nov 2026). Right after signing in: a quiet note when they used the old username, and the
   "Add your email" step when their account has none yet (it comes back at each sign-in until they add one). */
Object.assign(Acct,{
 afterMe(){const me=S.me;if(!me?.id||Acct.checked)return;Acct.checked=true;const t=Acct.typed;Acct.typed=null;
  if(!me.email)return setTimeout(()=>Acct.addEmail(),400);
  if(t!=null&&!t.includes('@'))setTimeout(()=>toast('Use your email next time: '+me.email),600)},
 addEmail(){const {d,close}=stackPop('Add your email',`<p style="margin:0 0 12px;color:var(--ink-2);line-height:1.55">You sign in with your email from now on. Your username still works for a short while.</p>
   <label for="aeM">Email</label><input id="aeM" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com">
   <div id="aeCode" hidden><label for="aeC" style="margin-top:12px">Code from the email</label><input id="aeC" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456"><p class="hint" style="margin:6px 0 0">It confirms the address, so a lost password can be reset by email. Check spam too.</p></div>
   <p id="aeErr" role="alert" style="margin:8px 0 0;min-height:1.2em;font-size:13px;color:var(--bad)"></p>`,
   `<button class="ghost" data-x>Later</button><button class="primary" id="aeGo">Save email</button>`);
  const m=d.querySelector('#aeM'),c=d.querySelector('#aeC'),b=d.querySelector('#aeGo'),err=d.querySelector('#aeErr');let key=null,busy=false;setTimeout(()=>m.focus(),80);
  const go=async()=>{if(busy)return;err.textContent='';busy=true;b.disabled=true;b.classList.add('is-busy');
   try{if(!key){const em=m.value.trim();if(!/^\S+@\S+\.\S+$/.test(em)){err.textContent='Enter your email address.';return}
     try{const r=await put(UI,'/ui/me/email',{email:em});key=r.key}catch(e){if(!/Saved, but/.test(e.message||''))throw e}
     S.me&&(S.me.email=em.toLowerCase());if(!key){close();toast('Saved. You sign in with '+em.toLowerCase()+' from now on.');return}
     m.disabled=true;d.querySelector('#aeCode').hidden=false;b.textContent='Confirm';setTimeout(()=>c.focus(),60);return}
    await post(UI,'/ui/me/email/verify',{key,code:c.value.trim()});S.me&&(S.me.emailVerified=true);close();toast('Email confirmed. You sign in with it from now on.')}
   catch(e){err.textContent=e.message||'That did not work.'}finally{busy=false;if(b.isConnected){b.disabled=false;b.classList.remove('is-busy')}}};
  b.onclick=e=>{e.stopPropagation();go()};d.querySelectorAll('input').forEach(i=>i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();go()}})}});
{const base=loadMe;loadMe=async function(...a){const r=await base.apply(this,a);try{Acct.afterMe()}catch{}return r}}
