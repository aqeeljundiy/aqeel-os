// Edit agent › Abilities (agent-optins.mjs): AdsPower and Composio per agent, each switch saving at once. Off means the
// agent has none of its tools and nothing asks it to sign in; the first start kept each only where it was used.
const ABIL_SAY={adspower:'Separate browser profiles for logins that must look like different people. Runs its own app on the box (heavy: about a gigabyte per agent).',
 composio:'Hundreds of outside apps through one Composio sign-in.'};
// an app's plain name and line from Names (labels.js) when it has one, else its id
const abilApp=n=>{const l=typeof labelOf==='function'?labelOf('mcp',n):null;return {name:(l&&l.name)||n,desc:(l&&l.description)||(l&&l.name&&l.name!==n?n:'')}};
const abilUsed=u=>u&&u.n?`Used ${plural(u.n,'time')} in the 14 days before the switch, last ${ago(u.last)}.`:'';
async function abilitiesTab(box,name){if(!box)return;let d;try{d=await UI('/ui/optins?agent='+encodeURIComponent(name))}catch(e){box.innerHTML=`<p class="hint">${esc(e.message)}</p>`;return}if(!box.isConnected)return;
 const n0=Object.keys(d.abilities).length;
 box.innerHTML=Object.entries(d.abilities).map(([k,v],i)=>`<div class="ab-row" ${st(i)}><div class="txt"><b>${esc(v.label)}</b><p class="hint">${esc(ABIL_SAY[k]||'')}${v.used?' '+esc(abilUsed(v.used)):''}</p></div>${toggle(v.on,v.label,`data-ab="${k}"${d.admin?'':' disabled'}`)}</div>`).join('')
  +((d.apps||[]).length?`<h3 class="ab-h">Sign-in apps</h3><p class="hint" style="margin:0 0 4px">Apps this agent signs in to. Off, it has none of their tools and is never asked to sign in.</p>`+d.apps.map((x,i)=>`<div class="ab-row" ${st(n0+i)}><div class="txt"><b>${esc(abilApp(x.name).name)}</b><p class="hint">${esc(abilApp(x.name).desc)}${x.used?' · '+esc(abilUsed(x.used)):''}</p></div>${toggle(x.on,x.name,`data-app="${esc(x.name)}"${d.admin?'':' disabled'}`)}</div>`).join(''):'');
 box.querySelectorAll('[data-ab]').forEach(t=>t.onchange=async()=>{const on=t.checked;t.disabled=true;
  try{await UI('/ui/optins',{method:'PUT',body:{agent:name,kind:t.dataset.ab,on}});toast(d.abilities[t.dataset.ab].label+(on?' on':' off')+' for '+ident(name).name+(t.dataset.ab==='adspower'&&on?'. It starts within a minute.':''))}
  catch(e){t.checked=!on;fail(e)}finally{t.disabled=false}});
 box.querySelectorAll('[data-app]').forEach(t=>t.onchange=async()=>{const on=t.checked;t.disabled=true;
  try{await UI('/ui/optins',{method:'PUT',body:{agent:name,kind:'app',name:t.dataset.app,on}});toast(t.dataset.app+(on?' on':' off')+' for '+ident(name).name)}
  catch(e){t.checked=!on;fail(e)}finally{t.disabled=false}})}
