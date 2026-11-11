// System › Settings › Cloud fixer (cloud-fixer.mjs): one row per routine (Claude account, trigger id, token), Test, and the plain steps to
// make a routine on claude.ai. The token is write-only: a saved one shows only "Saved", and an empty field keeps it.
const CloudFixer={d:null,rows:[],
 async load(){this.d=await UI('/ui/cloud-fixer');this.rows=(this.d.routines||[]).map(r=>({account:r.account,trigId:r.trigId,saved:true,token:'',last:r.last}));return this.d}};
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el);await settings(p,el,r);if(gone()||S.me?.admin===false||el.querySelector('#cfBox'))return;
 let d;try{d=await CloudFixer.load()}catch{return}if(gone()||el.querySelector('#cfBox'))return;
 const box=document.createElement('div');box.className='panel card';box.id='cfBox';box.style.marginBottom='16px';el.prepend(box);cloudBox(box)}}
function cloudBox(box){const d=CloudFixer.d,rows=CloudFixer.rows,st=d.status;
 const row=(x,k)=>`<div class="cf-row" data-k="${k}" style="padding:12px 0;border-top:1px solid var(--border)">
  <div class="cf-acc" role="group" aria-label="Claude account" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${(d.accounts||[]).map(a=>`<button type="button" class="small ${x.account===a.id?'primary':'ghost'}" data-act="cf-acc" data-acc="${esc(a.id)}" aria-pressed="${x.account===a.id}">${esc(a.label)}</button>`).join('')||'<span class="hint">No Claude account yet. Add one on Models.</span>'}</div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px"><input class="cf-trig" autocomplete="off" spellcheck="false" placeholder="Trigger id, trig_…" aria-label="Trigger id" value="${esc(x.trigId)}">
  <input class="cf-tok" type="password" autocomplete="new-password" spellcheck="false" placeholder="${x.saved?'Saved. Paste a new token to replace it':'Token (shown once on claude.ai)'}" aria-label="Token" value="${esc(x.token)}"></div>
  <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"><button type="button" class="small" data-act="cf-test" ${x.saved?'':'disabled'}>Test</button><button type="button" class="small ghost" data-act="cf-del">Remove</button>
  <span class="hint cf-say" aria-live="polite">${x.last?esc(x.last.ok?'Last fire worked.':x.last.why||'Last fire failed.'):''}</span></div></div>`;
 box.innerHTML=`<h2>Cloud fixer</h2><p class="sub">A bug in aqeelOS’s own code is fixed by a Claude Code routine in the cloud, which opens a pull request on GitHub. Add one routine per Claude account; aqeelOS uses the account with the most room.</p>
  ${st?.on?`<p class="sub">${esc('Cloud fixer: '+st.sent+' sent, '+st.merged+' merged, '+st.waiting+' waiting'+(st.using?'; using '+st.using:'')+'.')}</p>`:''}
  <div id="cfRows">${rows.map(row).join('')}</div>
  <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="small ghost" data-act="cf-add">${icon('plus',14)}Add a routine</button><button type="button" class="primary" data-act="cf-save">Save</button></div>
  <details class="cf-how" style="margin-top:14px"><summary>How to make a routine</summary><ol class="sub" style="margin:8px 0 0 18px">${(d.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ol></details>`;
 box.querySelectorAll('.cf-row').forEach(r=>{const x=rows[+r.dataset.k];r.querySelector('.cf-trig').oninput=e=>x.trigId=e.target.value;r.querySelector('.cf-tok').oninput=e=>x.token=e.target.value})}
const cfBox=a=>a.closest('#cfBox'),cfRow=a=>CloudFixer.rows[+a.closest('.cf-row').dataset.k];
ACT['cf-acc']=a=>{cfRow(a).account=a.dataset.acc;cloudBox(cfBox(a))};
ACT['cf-add']=a=>{CloudFixer.rows.push({account:(CloudFixer.d.accounts[0]||{}).id||'',trigId:'',token:'',saved:false});cloudBox(cfBox(a))};
ACT['cf-del']=a=>{const k=+a.closest('.cf-row').dataset.k;const box=cfBox(a);CloudFixer.rows.splice(k,1);cloudBox(box)};
ACT['cf-save']=async a=>{const box=cfBox(a);a.disabled=true;
 try{CloudFixer.d=await call('','/ui/cloud-fixer',{method:'PUT',body:{routines:CloudFixer.rows.map(r=>({account:r.account,trigId:r.trigId,token:r.token}))}});
  CloudFixer.rows=CloudFixer.d.routines.map(r=>({account:r.account,trigId:r.trigId,saved:true,token:'',last:r.last}));toast('Cloud fixer saved');cloudBox(box)}catch(e){a.disabled=false;fail(e)}};
ACT['cf-test']=async a=>{const x=cfRow(a),say=a.closest('.cf-row').querySelector('.cf-say');a.disabled=true;say.textContent='Starting a test run…';
 try{const r=await post(UI,'/ui/cloud-fixer/test',{trigId:x.trigId});say.textContent=r.ok?'It worked. A short test run started on claude.ai.':r.why||'It did not work.';if(r.ok)toast('Test run started')}catch(e){say.textContent='';fail(e)}finally{a.disabled=false}};
