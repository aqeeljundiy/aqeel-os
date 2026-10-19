// Sign-in notices for connected apps (sharing between agents: access.js). A notice says which app and which agent;
// "See details" explains what it is and what stops working, then offers the ways out: sign in, use another agent's
// sign-in, remove it from this agent, or later.
const Signins={shown:new Set(),
 snoozed(k){try{return (JSON.parse(localStorage.getItem('signinLater')||'{}')[k]||0)>Date.now()}catch{return false}},
 snooze(k){try{const m=JSON.parse(localStorage.getItem('signinLater')||'{}');m[k]=Date.now()+24*3600e3;localStorage.setItem('signinLater',JSON.stringify(m))}catch{}},
 async check(){if(!S.signedIn||S.me?.admin===false||document.hidden)return;let d;try{d=await UI('/ui/mcp/signins')}catch{return}this.items=d.items||[];
  for(const x of this.items){const k=x.agent+'|'+x.name;if(this.shown.has(k)||this.snoozed(k))continue;this.shown.add(k);
   Notices.show({key:'signin|'+k,kind:'warn',icon:'key',life:600000,title:(x.label||x.name)+' needs signing in',text:x.agentName+' can’t '+(x.does||'use it')+' until then.',
    actions:[{label:'See details',primary:true,run:()=>this.open(x)}]})}},
 open(x){const k=x.agent+'|'+x.name;const when=x.last?new Date(x.last).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'}):'';
  const why=x.why==='not signed in'?`It was added to ${esc(x.agentName)} but nobody has signed in to it yet.`:`Its sign-in stopped working${when?` (last signed in ${esc(when)})`:''}. Apps ask you to sign in again from time to time.`;
  const o=(x.others||[])[0];
  const d=drawer((x.label||x.name)+' needs signing in',`<div class="si-card">
    <div class="si-row"><span class="si-k">App</span><span><b>${esc(x.label||x.name)}</b>${x.url?`<small>${esc(x.url.replace(/^https?:\/\//,'').split('/')[0])}</small>`:''}</span></div>
    <div class="si-row"><span class="si-k">Agent</span><span>${Access.av({id:x.agent,name:x.agentName},20)} ${esc(x.agentName)}</span></div>
    <div class="si-row"><span class="si-k">What happened</span><span>${why}</span></div>
    <div class="si-row"><span class="si-k">Until then</span><span>${esc(x.agentName)} can’t ${esc(x.does||'use it')}.</span></div></div>
   <p class="hint" style="margin:14px 0 6px">Choose one:</p>
   <div class="si-opts">
    <button class="primary" data-si="signin">${icon('key',15)}Sign in to ${esc(x.app||x.name)}</button>
    ${o?`<button data-si="use">${icon('user',15)}Use ${esc(o.name)}’s sign-in</button>`:''}
    <button class="ghost" data-si="remove">${icon('trash',15)}${esc(x.agentName)} doesn’t need it: remove</button>
    <button class="ghost" data-si="later">${icon('clock',15)}Remind me tomorrow</button></div>
   <p class="hint" style="margin:12px 0 0">Signing in opens ${esc(x.app||'the app')}’s own page in a new tab. Pick the account ${x.account?`for <b>${esc(x.account)}</b> `:''}and allow access, then come back here.</p>`,`<button class="ghost" data-act="close">Close</button>`);
  const done=msg=>{closeLayers();toast(msg);document.querySelector('.cron-pop[data-k="'+CSS.escape('signin|'+k)+'"] .np-x')?.click()};
  d.querySelector('[data-si="signin"]').onclick=async()=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/mcp/start-signin',{agent:x.agent,name:x.name});const u=r.authorization_url||r.auth_url||r.url;if(!u)throw new Error(r.error||'No sign-in page came back.');if(w)w.location=u;else window.open(u,'_blank');done('Finish signing in on the page that opened')}catch(e){w?.close();fail(e)}};
  d.querySelector('[data-si="use"]')?.addEventListener('click',async()=>{try{await post(UI,'/ui/access',{kind:'mcp',id:x.name,agent:x.agent,on:true});done(x.agentName+' now uses '+o.name+'’s sign-in · ready in about a minute')}catch(e){fail(e)}});
  d.querySelector('[data-si="remove"]').onclick=async()=>{if(!await confirmBox('Remove '+(x.label||x.name)+' from '+x.agentName+'?',x.agentName+' stops trying to use it. Other agents keep theirs.','Remove'))return;
   try{await del(H,'/mcp/servers/'+encodeURIComponent(x.name)+'?profile='+encodeURIComponent(x.agent));done('Removed from '+x.agentName)}catch(e){fail(e)}};
  d.querySelector('[data-si="later"]').onclick=()=>{this.snooze(k);done('We’ll remind you tomorrow')}}};
setTimeout(()=>Signins.check(),20000);setInterval(()=>Signins.check(),15*60e3);
