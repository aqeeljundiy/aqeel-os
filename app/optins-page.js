// Edit agent › Abilities (agent-optins.mjs): AdsPower and Composio per agent, each switch saving at once. Off means the
// agent has none of its tools and nothing asks it to sign in; the first start kept each only where it was used.
const ABIL_SAY={adspower:'Separate browser profiles for logins that must look like different people. Runs its own app on the box (heavy: about a gigabyte per agent).',
 composio:'Hundreds of outside apps through one Composio sign-in.'};
const abilUsed=u=>u&&u.n?`Used ${plural(u.n,'time')} in the 14 days before the switch, last ${ago(u.last)}.`:'';
async function abilitiesTab(box,name){if(!box)return;let d;try{d=await UI('/ui/optins?agent='+encodeURIComponent(name))}catch(e){box.innerHTML=`<p class="hint">${esc(e.message)}</p>`;return}if(!box.isConnected)return;
 box.innerHTML=Object.entries(d.abilities).map(([k,v],i)=>`<div class="ab-row" ${st(i)}><div class="txt"><b>${esc(v.label)}</b><p class="hint">${esc(ABIL_SAY[k]||'')}${v.used?' '+esc(abilUsed(v.used)):''}</p></div>${toggle(v.on,v.label,`data-ab="${k}"${d.admin?'':' disabled'}`)}</div>`).join('');
 box.querySelectorAll('[data-ab]').forEach(t=>t.onchange=async()=>{const on=t.checked;t.disabled=true;
  try{await UI('/ui/optins',{method:'PUT',body:{agent:name,kind:t.dataset.ab,on}});toast(d.abilities[t.dataset.ab].label+(on?' on':' off')+' for '+ident(name).name+(t.dataset.ab==='adspower'&&on?'. It starts within a minute.':''))}
  catch(e){t.checked=!on;fail(e)}finally{t.disabled=false}})}
