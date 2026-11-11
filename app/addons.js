// Connections › Added by people (11 Nov 2026, admins only): every person may add apps, skills and plugins to the agents
// they own (personal add-ons, app/addons.mjs). This side panel lists who added what, to which agent, how and when, and
// keeps the block list: an app name or a host (example.com) that nobody may add; adding one is refused with a clear line.
const ADD_KIND={mcp:['plug','App'],skill:['wand','Skill'],plugin:['layers','Plugin']};
const Addons={
 async open(){const d=drawer('Added by people',`<div class="ad-body">${skeletonRows(4)}</div>`,`<button class="ghost" data-act="close">Close</button>`,{size:'md'});
  const body=d.querySelector('.ad-body');let data;try{data=await UI('/ui/addons')}catch(e){body.innerHTML=errLine('the list');return}
  const paint=()=>{if(!d.isConnected)return;const q=(Addons.q||'').trim().toLowerCase();
   const rows=data.added.filter(x=>!q||[x.name,x.url,x.by?.name,x.agentName,ADD_KIND[x.kind]?.[1],x.via].join(' ').toLowerCase().includes(q));
   body.innerHTML=`<p class="hint" style="margin:0 0 12px">Everyone can add apps, skills and plugins to the agents they own. Tools that run code on the AI box still need the “Terminal, files and code” permission.</p>
    <h3 class="ad-h">Blocked</h3>
    <div class="ad-block-row"><input id="adVal" placeholder="An app name (notion) or a host (example.com)" autocomplete="off" aria-label="App or host to block"><input id="adNote" placeholder="Why (optional)" autocomplete="off" aria-label="Why it is blocked"><button class="primary" id="adGo">${icon('plus',15)}Block</button></div>
    <p class="err-line" id="adErr" role="alert" hidden></p>
    ${data.blocked.length?`<div class="card list">${data.blocked.map((b,i)=>`<div class="row" ${st(i)}><div class="main-c"><span class="ic">${icon('alert',16)}</span><div class="txt"><b>${esc(b.value)}</b><span>${esc([b.note,b.by?.name?'by '+b.by.name:'',b.at?ago(b.at/1000):''].filter(Boolean).join(' · '))}</span></div></div><div class="act"><button class="ghost small" data-adun="${esc(b.value)}">Unblock</button></div></div>`).join('')}</div>`:'<p class="hint">Nothing is blocked. Everyone may add any app, skill or plugin to their own agents.</p>'}
    <h3 class="ad-h">Added</h3>
    <div class="search${Addons.q?' has-q':''}" style="margin:0 0 10px">${icon('search',16)}<input id="adQ" type="search" placeholder="Search by person, agent or app" value="${esc(Addons.q||'')}" aria-label="Search what people added"></div>
    ${rows.length?`<div class="card list">${rows.slice(0,200).map((x,i)=>{const [ic,label]=ADD_KIND[x.kind]||['plug',x.kind];return `<div class="row" ${st(Math.min(i,12))}><div class="main-c"><span class="ic">${icon(ic,16)}</span><div class="txt"><b>${esc(x.name)}</b><span>${esc([label,x.agentName?'on '+x.agentName:'',x.via].filter(Boolean).join(' · '))}</span>${x.url?`<small class="hub-id">${esc(x.url)}</small>`:''}</div></div><div class="act ad-by"><small class="cn-lbl">Added by</small><span>${esc(x.by?.name||'Someone')}</span><small class="hint">${esc(x.at?ago(x.at/1000):'')}</small></div></div>`}).join('')}</div>`:`<p class="hint">${q?'Nothing matches.':'Nobody has added anything yet.'}</p>`}`;
   const qi=body.querySelector('#adQ');let t;qi.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{Addons.q=qi.value;paint();const n=body.querySelector('#adQ');n.focus();n.setSelectionRange(n.value.length,n.value.length)},150)};
   const go=body.querySelector('#adGo'),err=body.querySelector('#adErr');
   const add=async()=>{const v=body.querySelector('#adVal').value.trim();if(!v){err.textContent='Type an app name or a host.';err.hidden=false;return}go.disabled=true;
    try{const r=await post(UI,'/ui/addons/block',{value:v,note:body.querySelector('#adNote').value.trim()});data.blocked=r.blocked;toast(v+' is blocked');paint()}catch(e){err.textContent=e.message||'Could not block it.';err.hidden=false}finally{go.disabled=false}};
   go.onclick=add;body.querySelector('#adVal').onkeydown=e=>{if(e.key==='Enter')add()};
   body.querySelectorAll('[data-adun]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await del(UI,'/ui/addons/block?value='+encodeURIComponent(b.dataset.adun));data.blocked=r.blocked;toast(b.dataset.adun+' is no longer blocked');paint()}catch(e){b.disabled=false;fail(e)}})};
  paint()}};
ACT['cn-addons']=()=>Addons.open();
