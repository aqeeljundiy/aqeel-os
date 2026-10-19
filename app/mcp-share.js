// Connected apps › "Use on other agents": the same app, with its sign-in, on other agents too (admins only).
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;
 el.querySelectorAll('[data-act="mcp-dup"]').forEach(b=>{const n=b.dataset.name;if(n==='aqeelos-notify'||b.previousElementSibling?.dataset?.act==='mcp-share')return;
  b.insertAdjacentHTML('beforebegin',`<button class="ghost icon" title="Use on other agents" aria-label="Use ${esc(n)} on other agents" data-act="mcp-share" data-name="${esc(n)}">${icon('user',16)}</button>`)})}}
ACT['mcp-share']=async a=>{const name=a.dataset.name,from=agentProfile()||'default';let d;try{d=await UI('/ui/mcp/share?from='+encodeURIComponent(from)+'&name='+encodeURIComponent(name))}catch(e){return fail(e)}
 const list=d.agents||[];
 const dr=drawer('Use '+name+' on other agents',list.length?`<p class="hint" style="margin:0 0 14px">The other agents get ${esc(name)} with the same sign-in, so nobody signs in again. They restart once nobody is mid-reply (about a minute).</p>
  <div class="share-agents">${list.map((x,i)=>`<label class="share-row${x.has?' has':''}" ${st(i)}><span class="ic">${icon('user',16)}</span><span class="txt"><b>${esc(x.name)}</b><span>${x.has?'Already has '+esc(name):'Not yet'}</span></span>${toggle(x.has,x.name,'value="'+esc(x.id)+'"'+(x.has?' disabled':''))}</label>`).join('')}</div>`
  :`<p class="hint">There are no other agents yet.</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="shareGo" disabled>Add to the chosen agents</button>`);
 const go=dr.querySelector('#shareGo'),boxes=[...dr.querySelectorAll('.share-agents input:not([disabled])')];
 boxes.forEach(c=>c.onchange=()=>{const n=boxes.filter(x=>x.checked).length;go.disabled=!n;go.textContent=n?'Add to '+n+(n===1?' agent':' agents'):'Add to the chosen agents'});
 if(go)go.onclick=async()=>{go.disabled=true;try{const r=await post(UI,'/ui/mcp/share',{from,name,to:boxes.filter(x=>x.checked).map(x=>x.value)});closeLayers();toast(name+' is now on '+r.agents.join(', ')+' · ready in about a minute')}catch(e){go.disabled=false;fail(e)}}};
// A connected app whose sign-in ran out: admins get one notice per app, with a Sign in button that opens its page.
const Signins={shown:new Set(),async check(){if(!S.signedIn||S.me?.admin===false||document.hidden)return;let d;try{d=await UI('/ui/mcp/signins')}catch{return}
 for(const x of d.items||[]){const k=x.agent+'|'+x.name;if(this.shown.has(k))continue;this.shown.add(k);
  Notices.show({key:'signin|'+k,kind:'warn',icon:'key',life:600000,title:x.name+' needs signing in again',text:x.agentName+' can’t use '+x.name+' until you sign in ('+x.why+').',
   actions:[{label:'Sign in',primary:true,run:async()=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/mcp/start-signin',{agent:x.agent,name:x.name});const u=r.authorization_url||r.auth_url||r.url;if(!u)throw new Error(r.error||'No sign-in page came back.');if(w)w.location=u;else window.open(u,'_blank');toast('Finish signing in on the page that opened')}catch(e){w?.close();fail(e)}}}]})}}};
setTimeout(()=>Signins.check(),20000);setInterval(()=>Signins.check(),15*60e3);
