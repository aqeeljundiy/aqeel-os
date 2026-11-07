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
 setup(){Acct.card(`<form class="card" id="acSetup">${Acct.head()}<h1>Create the owner account</h1><p>This is a new install. The owner can do everything and invites the others.</p>
   <label for="acN">Your name</label><input id="acN" autocomplete="name" placeholder="Sam Lee">
   <label for="acU">Username</label><input id="acU" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="sam"><p class="hint ac-hint">You sign in with this.</p>
   ${Acct.pw('acP')}<p class="err" role="alert"></p><button class="primary" type="submit">Create account</button><p class="foot">${icon('lock',13)} Private · ${esc(location.host)}</p></form>`,f=>{
   Acct.eyes(f);const n=f.querySelector('#acN'),u=f.querySelector('#acU');let typed=false;n.focus();
   const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,32);
   // the username is suggested once, when they leave the name field and it is still empty; clicking into the suggestion
   // selects it, so what they type replaces it instead of being added to it
   let suggested=false;n.onchange=()=>{if(!typed&&!u.value&&slug(n.value)){u.value=slug(n.value);suggested=true}};
   let armed=false;u.oninput=()=>{typed=true;suggested=false};u.onblur=()=>{armed=false};
   u.onfocus=()=>{if(suggested){armed=true;setTimeout(()=>u.select(),0)}};u.onclick=()=>{if(suggested&&armed){armed=false;u.select()}};
   Acct.form(f,async()=>{const pw=f.querySelector('#acP').value;if(!n.value.trim())throw Object.assign(new Error('Tell us your name.'),{status:400});if(pw.length<8)throw Object.assign(new Error('Use a password of at least 8 characters.'),{status:400});
    const d=await Acct.call('/auth/setup',{name:n.value.trim(),username:u.value.trim(),password:pw});Acct.showCode(d.recovery,'Your account is ready')})})},

 /* the recovery code, shown once; Continue waits until they say it is saved */
 showCode(code,title){Acct.card(`<form class="card" id="acCode">${Acct.head()}<h1>${esc(title)}</h1><p>Save this recovery code somewhere safe, like a password manager. It signs you in once if you lose your password or your email.</p>
   <div class="rc-box"><code>${esc(code)}</code><button type="button" class="ghost small" data-copy>${icon('copy',15)}Copy</button></div>
   <label class="pick rc-ok"><input type="checkbox" id="acSaved"><span>I saved it</span></label><p class="err" role="alert"></p><button class="primary" type="submit" disabled>Continue</button></form>`,f=>{
   const c=f.querySelector('#acSaved'),b=f.querySelector('button.primary');c.onchange=()=>{b.disabled=!c.checked};
   f.querySelector('[data-copy]').onclick=async e=>{const ok=await copyText(code,'');e.currentTarget.innerHTML=icon(ok?'check':'copy',15)+(ok?'Copied':'Copy')};
   f.onsubmit=e=>{e.preventDefault();if(c.checked)Acct.signedIn()}})},

 /* forgot password: a link to the confirmed email (or the recovery code, for the owner) */
 forgot(){Acct.card(`<form class="card" id="acForgot">${Acct.head()}<h1>Reset your password</h1><p>We email a link to the address confirmed on your account.</p>
   <label for="acW">Username or email</label><input id="acW" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Your username or email">
   <p class="err" role="alert"></p><button class="primary" type="submit">Send reset link</button>
   <p class="ac-links"><button type="button" class="link" data-ac="back">Back to sign in</button><button type="button" class="link" data-ac="code">Use a recovery code</button></p>
   <p class="hint ac-hint">No confirmed email? An admin can set a new password for you under People.</p></form>`,f=>{
   Acct.links(f);const w=f.querySelector('#acW');w.value=$('#nm')?.value||'';w.focus();
   Acct.form(f,async()=>{if(!w.value.trim())throw Object.assign(new Error('Enter your username or email.'),{status:400});await Acct.call('/auth/forgot',{who:w.value.trim()});
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
  if(!info)return Acct.card(`<div class="card">${Acct.head()}<h1>This link doesn't work</h1><p>It has expired or was already used. Ask for a new one from the sign-in page.</p><p class="ac-links"><button type="button" class="link" data-ac="forgot">Send a new link</button><button type="button" class="link" data-ac="back">Go to sign in</button></p></div>`,Acct.links);
  Acct.card(`<form class="card" id="acReset">${Acct.head()}<h1>Pick a new password</h1><p>For ${esc(info.name)}${info.username?' (@'+esc(info.username)+')':''}. Every other device signed in as you is signed out.</p>
   ${Acct.pw('acNP','New password')}<p class="err" role="alert"></p><button class="primary" type="submit">Save and sign in</button></form>`,f=>{
   Acct.eyes(f);f.querySelector('#acNP').focus();Acct.form(f,async()=>{await Acct.call('/auth/reset',{t:tok,password:f.querySelector('#acNP').value});Acct.signedIn()})})},

 links(f){f.querySelectorAll('[data-ac]').forEach(b=>b.onclick=()=>{const g=b.dataset.ac;if(g==='forgot')return Acct.forgot();if(g==='code')return Acct.recover();
  if(location.hash.startsWith('#reset/')||location.hash.startsWith('#/reset/'))history.replaceState(null,'','/#signin');Acct.card(signinHtml().replace(/^<div class="signin">|<\/div>$/g,''),()=>bindSignin(true))})}};

// the sign-in page: says this install's name, has "Forgot password?", and turns into the setup screen on a new install
{const html=signinHtml;signinHtml=()=>html().replace('<p>Sign in to aqeelOS.</p>','<p>Sign in to '+esc(Brand.name)+'.</p>').replace('<p class="foot">','<p class="ac-links"><button type="button" class="link" data-ac="forgot">Forgot password?</button></p><p class="foot">')}
{const bind=bindSignin;bindSignin=again=>{bind();const f=$('#signin');if(f)Acct.links(f);if(again)return;
 fetch('/auth/setup',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.needed&&$('#signin'))Acct.setup()}).catch(()=>{})}}
{const base=render;render=function(){const m=/^#\/?reset\/([\w-]+)/.exec(location.hash);if(m){closeLayers();return Acct.reset($('#root'),m[1])}return base()}}
// a reset link opened while this tab shows the sign-in page (the app's own hash handler only runs when signed in)
addEventListener('hashchange',()=>{if(!S.signedIn&&/^#\/?reset\//.test(location.hash))render()});
