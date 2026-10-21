// Sign-in notices for connected apps (sharing between agents: access.js). A notice says which app and which agent;
// "See details" explains what it is and what stops working, then offers the ways out: sign in, use another agent's
// sign-in, remove it from this agent, or later.
// Why an agent asks (why.mjs): its purpose, and the chat message that led to it, with a way to open that chat
const Why={src:{whatsapp:'WhatsApp',telegram:'Telegram',slack:'Slack',discord:'Discord',signal:'Signal',api_server:'aqeelOS',cli:'command line',cron:'a schedule'},
 meta(f){const t=f.at?new Date(f.at).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';return [f.who,this.src[f.source]||f.source,t].filter(Boolean).join(' · ')},
 purpose(x){const p=String(x.purpose||'').trim();return p?p[0].toUpperCase()+p.slice(1):''},
 // rows for a card: .si-row (sign-in card) or .bn-why (Bottlenecks list)
 rows(x,cls){const p=this.purpose(x),f=x.from,r=(k,v)=>'<div class="'+cls+'"><span class="'+(cls==='si-row'?'si-k':'bn-k')+'">'+k+'</span><span>'+v+'</span></div>';
  return (p?r('Why',esc(p)):'')+(f?.ask?r('From','“'+esc(f.ask)+'”<small>'+esc(this.meta(f))+(f.chat?' · <button type="button" class="linkish" data-why-chat="'+esc(f.chat)+'">Open chat</button>':'')+'</small>'):'')},
 none(x){return x.origin?.by==='person'?'Added by a person in Abilities.':'No reason was recorded: it was added before aqeelOS kept reasons.'},
 // the chat the request came from, on the agent that asked
 open(agent,chat){closeLayers();if((S.profile||'default')!==agent&&typeof switchAgent==='function')switchAgent(agent);go('/chat/'+chat)},
 wire(root,agent){root.querySelectorAll('[data-why-chat]').forEach(b=>b.onclick=e=>{e.stopPropagation();this.open(b.closest('[data-agent]')?.dataset.agent||agent,b.dataset.whyChat)})}};
const Signins={shown:new Set(),
 snoozed(k){try{return (JSON.parse(localStorage.getItem('signinLater')||'{}')[k]||0)>Date.now()}catch{return false}},
 // after a sign-in: check every 10 s for two minutes, so the reminder goes away as soon as it lands
 watch(x){const k=x.agent+'|'+x.name;let n=0;clearInterval(this['w'+k]);this['w'+k]=setInterval(async()=>{if(++n>=12||!S.signedIn)clearInterval(this['w'+k]);if(!S.signedIn)return;let d;try{d=await UI('/ui/mcp/signins')}catch{return}
  if(!(d.items||[]).some(y=>y.agent===x.agent&&y.name===x.name)){clearInterval(this['w'+k]);this.shown.delete(k);toast((x.label||x.name)+' is signed in for '+x.agentName);if(typeof Bottlenecks!=='undefined')Bottlenecks.check()}},10000)},
 snooze(k){try{const m=JSON.parse(localStorage.getItem('signinLater')||'{}');m[k]=Date.now()+24*3600e3;localStorage.setItem('signinLater',JSON.stringify(m))}catch{}},
 async check(){if(!S.signedIn||S.me?.admin===false||document.hidden)return;let d;try{d=await UI('/ui/mcp/signins')}catch{return}this.items=d.items||[];
  for(const x of this.items){const k=x.agent+'|'+x.name;if(this.shown.has(k)||this.snoozed(k))continue;this.shown.add(k);
   Notices.show({key:'signin|'+k,kind:'warn',icon:'key',life:600000,title:(x.label||x.name)+' needs signing in',text:(x.origin?.purpose?x.agentName+' wants it '+String(x.origin.purpose).replace(/^(to |for )?/i,m=>m||'for ')+'. ':'')+x.agentName+' can’t '+(x.does||'use it')+' until then.',
    actions:[{label:'See details',primary:true,run:()=>this.open(x)}]})}},
 open(x){const k=x.agent+'|'+x.name;const when=x.last?new Date(x.last).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'}):'';
  const why=x.why==='not signed in'?`It was added to ${esc(x.agentName)} but nobody has signed in to it yet.`:`Its sign-in stopped working${when?` (last signed in ${esc(when)})`:''}. Apps ask you to sign in again from time to time.`;
  const o=(x.others||[])[0];
  const d=drawer((x.label||x.name)+' needs signing in',`<div class="si-card">
    <div class="si-row"><span class="si-k">App</span><span><b>${esc(x.label||x.name)}</b>${x.url?`<small>${esc(x.url.replace(/^https?:\/\//,'').split('/')[0])}</small>`:''}</span></div>
    <div class="si-row"><span class="si-k">Agent</span><span>${Access.av({id:x.agent,name:x.agentName},20)} ${esc(x.agentName)}</span></div>
    <div class="si-row"><span class="si-k">What happened</span><span>${why}</span></div>
    ${Why.rows({purpose:x.origin?.purpose,from:x.origin?.from},'si-row')||`<div class="si-row"><span class="si-k">Why</span><span class="hint">${esc(Why.none(x))}</span></div>`}
    <div class="si-row"><span class="si-k">Until then</span><span>${esc(x.agentName)} can’t ${esc(x.does||'use it')}.</span></div></div>
   <p class="hint" style="margin:14px 0 6px">Choose one:</p>
   <div class="si-opts">
    <button class="primary" data-si="signin">${icon('key',15)}Sign in to ${esc(x.app||x.name)}</button>
    ${o?`<button data-si="use">${icon('user',15)}Use ${esc(o.name)}’s sign-in</button>`:''}
    <button class="ghost" data-si="remove">${icon('trash',15)}${esc(x.agentName)} doesn’t need it: remove</button>
    <button class="ghost" data-si="later">${icon('clock',15)}Remind me tomorrow</button>
    <button class="ghost" data-si="other">${icon('chat',15)}Something else…</button></div>
   <div class="si-other" hidden><label for="siTxt">Tell ${esc(x.agentName)} why, or ask something</label><textarea id="siTxt" rows="3" placeholder="For example: you don’t need Composio for this, use the Gmail connection instead"></textarea><div class="si-other-acts"><button class="primary small" data-si="send">Send to ${esc(x.agentName)}</button><span class="hint">It goes to a new chat with ${esc(x.agentName)}; this reminder waits a day.</span></div></div>
   <p class="hint" style="margin:12px 0 0">Signing in opens ${esc(x.app||'the app')}’s own page in a new tab. Pick the account ${x.account?`for <b>${esc(x.account)}</b> `:''}and allow access, then come back here.</p>`,`<button class="ghost" data-act="close">Close</button>`);
  Why.wire(d,x.agent);
  const done=msg=>{closeLayers();toast(msg);document.querySelector('.cron-pop[data-k="'+CSS.escape('signin|'+k)+'"] .np-x')?.click()};
  d.querySelector('[data-si="signin"]').onclick=async()=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/mcp/start-signin',{agent:x.agent,name:x.name});const u=r.authorization_url||r.auth_url||r.url;if(!u)throw new Error(r.error||'No sign-in page came back.');if(w)w.location=u;else window.open(u,'_blank');done('Finish signing in on the page that opened');this.watch(x)}catch(e){w?.close();fail(e)}};
  d.querySelector('[data-si="use"]')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.innerHTML='<span class="spinner tiny"></span>Sharing '+esc(o.name)+'’s sign-in…';try{const r=await post(UI,'/ui/access',{kind:'mcp',id:x.name,agent:x.agent,on:true,from:o.id});if(r?.changed===false)throw new Error('Nothing was copied: '+x.agentName+' is the agent the others take this sign-in from, so it has to sign in itself.');done(x.agentName+' now uses '+o.name+'’s sign-in · ready in about a minute');this.watch(x)}catch(e){b.disabled=false;b.innerHTML=icon('user',15)+'Use '+esc(o.name)+'’s sign-in';fail(e)}});
  d.querySelector('[data-si="other"]').onclick=()=>{const b=d.querySelector('.si-other');b.hidden=false;b.querySelector('textarea').focus()};
  d.querySelector('[data-si="send"]').onclick=async()=>{const t=d.querySelector('#siTxt').value.trim();if(!t){d.querySelector('#siTxt').focus();return}this.snooze(k);done('Sent to '+x.agentName);
   if((S.profile||'default')!==x.agent&&typeof switchAgent==='function')switchAgent(x.agent);go('/chat');setTimeout(()=>{if(typeof Chat!=='undefined'&&Chat.send)Chat.send('(About the '+(x.label||x.name)+' sign-in it asked for) '+t)},1500)};
  d.querySelector('[data-si="remove"]').onclick=async()=>{if(!await confirmBox('Remove '+(x.label||x.name)+' from '+x.agentName+'?',x.agentName+' stops trying to use it. Other agents keep theirs.','Remove'))return;
   try{await del(H,'/mcp/servers/'+encodeURIComponent(x.name)+'?profile='+encodeURIComponent(x.agent));done('Removed from '+x.agentName)}catch(e){fail(e)}};
  d.querySelector('[data-si="later"]').onclick=()=>{this.snooze(k);done('We’ll remind you tomorrow')}}};
setTimeout(()=>Signins.check(),20000);setInterval(()=>Signins.check(),15*60e3);
