// The Cloud fixer card (cloud-fixer.mjs), on System › Settings and on Models › Accounts (one component, mounted on both).
// One row per Claude account, in the order aqeelOS will use them (the server sorts: most room first). Connect opens three plain steps
// inline; the token is write-only and never comes back to the browser. Row states come from the server (accountRows).
const CloudFixer={d:null,open:null,say:{},draft:{},busy:{},
 async load(){this.d=await UI('/ui/cloud-fixer');return this.d},
 // the two one-time GitHub steps and the app install: GitHub cannot be asked without a token, so the owner ticks them (kept in this browser)
 gh:[['auto','Auto-merge is allowed','On GitHub open the repository, then Settings › General › Pull Requests, and tick “Allow auto-merge”.'],
  ['tests','The “tests” check is required on main','In the repository, Settings › Branches: add a rule for main, tick “Require status checks to pass before merging” and pick “tests”. Leave reviews off.'],
  ['app','The Claude GitHub app is installed on the repository','On claude.ai/code, open the repository’s settings and install the Claude GitHub app.']],
 ghDone(){return store.get('cfGh',{})}};
const cfWhen=ms=>{const d=new Date(ms),n=new Date(),t=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return d.toDateString()===n.toDateString()?t:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+t};
const cfState=r=>r.state==='none'?['','Not connected']:r.state==='limit'?['warn','At its limit until '+cfWhen(r.until)]:r.testOk===false?['out','Connected · the last test failed']:['on','Connected · '+(r.testedAt?'tested '+ago(Math.round(r.testedAt/1000)):'not tested yet')];
async function cfMount(el,gone,where){if(gone()||S.me?.admin===false||el.querySelector('#cfBox'))return;
 try{await CloudFixer.load()}catch{return}
 if(gone()||el.querySelector('#cfBox'))return;const box=document.createElement('div');box.className='panel card cf-box';box.id='cfBox';where(box);cloudBox(box)}
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el);await settings(p,el,r);await cfMount(el,gone,b=>el.prepend(b))}}
{const accounts=PAGES.accounts;PAGES.accounts=async(p,el,r)=>{const gone=pageTok(el);await accounts(p,el,r);await cfMount(el,gone,b=>el.append(b))}}
// Models › AI accounts is put together by models-page.js from the accounts page it captured before this file loaded, so the
// card is added to that tab here (12 Nov 2026: it never showed on Models)
{const models=PAGES.models;PAGES.models=async(p,el,r)=>{const gone=pageTok(el);await models(p,el,r);if(S.tab.models!=="AI accounts")return;const host=el.querySelector("#mtab>div");if(host)await cfMount(host,()=>gone()||!host.isConnected,b=>host.append(b))}}
function cloudBox(box){const d=CloudFixer.d,rows=d.rows||[],st=d.status,on=rows.filter(r=>r.state!=='none'),nx=rows.find(r=>r.next),done=CloudFixer.ghDone();
 const row=(r,i)=>{const [sc,sl]=cfState(r),open=CloudFixer.open===r.id,dr=CloudFixer.draft[r.id]||{},say=CloudFixer.say[r.id]||'',busy=!!CloudFixer.busy[r.id],conn=r.state!=='none',bad=conn&&r.testOk===false;
  const bars=r.sess||r.week?miniBar('Session',r.sess)+miniBar('Week',r.week):`<span class="hint">${r.signedIn?'Its limits show after its first check':'Not signed in on Models, so its limits are unknown'}</span>`;
  const steps=`<div class="cf-steps"><div class="cf-steps-in"><ol class="cf-ol">
    <li><span class="cf-n">1</span><div><b>Open claude.ai/code/routines as ${esc(r.label)}</b><p class="hint">It opens in a new tab. If another Claude account is signed in there, switch to ${esc(r.label)} first.</p><button type="button" class="small" data-act="cf-go">${icon('link',14)}Open claude.ai/code/routines</button></div></li>
    <li><span class="cf-n">2</span><div><b>Create a routine and paste the instructions</b><p class="hint">Press New routine. Name it aqeelOS fixer, choose the repository <span class="mono">${esc(d.repo)}</span>, then paste the instructions into its instructions box.</p><button type="button" class="small" data-act="cf-copy">${icon('copy',14)}Copy the instructions</button>
     <details class="cf-pr"><summary>Read the instructions first</summary><pre>${esc(d.prompt)}</pre></details></div></li>
    <li><span class="cf-n">3</span><div><b>Add an API trigger, then paste its id and token here</b><p class="hint">In the routine, under Select a trigger, press Add another trigger, choose API and press Generate token. The token is shown only once, so paste it here right away.</p>
     <div class="cf-fields"><label class="cf-f"><span>Trigger id</span><input class="cf-trig" autocomplete="off" spellcheck="false" placeholder="trig_…" value="${esc(dr.trigId||'')}"></label><label class="cf-f"><span>Token</span><input class="cf-tok" type="password" autocomplete="new-password" spellcheck="false" placeholder="Paste the token" value="${esc(dr.token||'')}"></label></div>
     <div class="cf-go-row"><button type="button" class="primary small" data-act="cf-save" ${busy?'disabled':''}>Save and test</button><span class="hint cf-say" aria-live="polite">${esc(say)}</span></div></div></li></ol></div></div>`;
  return `<div class="cf-item ${open?'open':''}" data-id="${esc(r.id)}"><div class="pri-row cf-row"><span class="pri-n" ${conn?'':'style="visibility:hidden"'}>${i+1}</span>${logoImg('claude.ai',(r.label||'C')[0].toUpperCase())}
   <div class="txt"><b><span class="cf-name">${esc(r.label)}</span>${r.next?'<span class="chip cf-next" title="aqeelOS sends the next fix to this account">Next</span>':''}</b><span class="pri-st ${sc}">${sc?'<i class="dot"></i>':''}${esc(sl)}</span></div>
   <div class="pri-lim">${bars}</div>
   <div class="cf-btns">${conn?`<button type="button" class="${bad?'primary ':''}small" data-act="cf-test" ${busy?'disabled':''}>${bad?'Test again':'Test'}</button><button type="button" class="ghost small" data-act="cf-del">Remove</button>`:`<button type="button" class="primary small" data-act="cf-open" aria-expanded="${open}">${open?'Close':'Connect'}</button>`}</div></div>
   ${conn?`<p class="hint cf-say cf-say-row ${bad?'bad':''}" aria-live="polite">${esc(say||(bad?r.why:''))}</p>`:steps}</div>`};
 const ghRow=([k,t,how])=>`<label class="cf-gh"><input type="checkbox" data-cfgh="${k}" ${done[k]?'checked':''}><span><b>${esc(t)}</b><small>${esc(how)}</small></span></label>`;
 const ghN=()=>{const v=CloudFixer.ghDone(),n=CloudFixer.gh.filter(g=>v[g[0]]).length;return n===CloudFixer.gh.length?'all done':n+' of '+CloudFixer.gh.length+' done'};
 box.innerHTML=`<h2>Cloud fixer</h2><p class="sub">When aqeelOS finds a bug in its own code, Claude fixes it in the cloud and the fix installs itself at night.${on.length?'':' Connect one Claude account to turn it on.'}</p>
  ${on.length?`<p class="hint cf-line">aqeelOS sends each fix to the connected account with the most room left.${nx?' Next: <b>'+esc(nx.label)+'</b>.':''}${st?.on?' '+esc('So far '+st.sent+' sent, '+st.merged+' merged, '+st.waiting+' waiting.'):''}</p>`:''}
  <div class="cf-list">${rows.map(row).join('')||'<p class="hint">No Claude account yet. <a href="#/models/accounts">Add one on Models</a>, then connect it here.</p>'}</div>
  <details class="cf-once" ${CloudFixer.ghOpen?'open':''}><summary>One-time setup on GitHub<span class="cf-gh-n">${ghN()}</span></summary><div class="cf-once-in"><p class="hint">Tick each one when it is done. aqeelOS cannot check these on GitHub, so the ticks are only your own reminder.</p>${CloudFixer.gh.map(ghRow).join('')}</div></details>`;
 box.querySelectorAll('.cf-item').forEach(r=>{const dr=CloudFixer.draft[r.dataset.id]=CloudFixer.draft[r.dataset.id]||{},t=r.querySelector('.cf-trig'),k=r.querySelector('.cf-tok');if(t)t.oninput=e=>dr.trigId=e.target.value;if(k)k.oninput=e=>dr.token=e.target.value});
 box.querySelector('.cf-once').ontoggle=e=>CloudFixer.ghOpen=e.target.open;
 box.querySelectorAll('[data-cfgh]').forEach(c=>c.onchange=()=>{const v=CloudFixer.ghDone();v[c.dataset.cfgh]=c.checked;store.set('cfGh',v);box.querySelector('.cf-gh-n').textContent=ghN()})}
const cfBox=a=>a.closest('#cfBox'),cfId=a=>a.closest('.cf-item').dataset.id,cfRowOf=a=>(CloudFixer.d.rows||[]).find(r=>r.id===cfId(a));
const cfSay=(box,id,t)=>{CloudFixer.say[id]=t;const x=box.querySelector(`.cf-item[data-id="${CSS.escape(id)}"] .cf-say`);if(x)x.textContent=t};
const cfRefresh=async box=>{await CloudFixer.load();cloudBox(box)};
// the routines the server keeps, as the save call wants them: an empty token keeps the saved one
const cfKeep=skip=>(CloudFixer.d.routines||[]).filter(r=>r.account!==skip).map(r=>({account:r.account,trigId:r.trigId,token:''}));
ACT['cf-open']=a=>{const it=a.closest('.cf-item'),id=it.dataset.id,box=cfBox(a),was=CloudFixer.open===id;
 box.querySelectorAll('.cf-item.open').forEach(x=>{x.classList.remove('open');const b=x.querySelector('[data-act="cf-open"]');if(b){b.textContent='Connect';b.setAttribute('aria-expanded','false')}});
 CloudFixer.open=was?null:id;if(!was){it.classList.add('open');a.textContent='Close';a.setAttribute('aria-expanded','true');setTimeout(()=>it.querySelector('.cf-trig')?.focus({preventScroll:true}),260)}};
ACT['cf-go']=()=>{window.open('https://claude.ai/code/routines','_blank','noopener')};
ACT['cf-copy']=a=>navigator.clipboard?.writeText(CloudFixer.d.prompt).then(()=>toast('Instructions copied. Paste them into the routine.'),()=>toast('Could not copy. Open “Read the instructions first” and copy them by hand.','err'));
ACT['cf-save']=async a=>{const box=cfBox(a),id=cfId(a),dr=CloudFixer.draft[id]||{},trigId=String(dr.trigId||'').trim(),token=String(dr.token||'').trim();
 if(!trigId||!token)return cfSay(box,id,'Paste both the trigger id and the token first.');
 CloudFixer.busy[id]=1;a.disabled=true;cfSay(box,id,'Saving…');
 try{CloudFixer.d=await call('','/ui/cloud-fixer',{method:'PUT',body:{routines:[...cfKeep(id),{account:id,trigId,token}]}});
  cfSay(box,id,'Saved. Starting a test run…');const r=await post(UI,'/ui/cloud-fixer/test',{trigId});
  delete CloudFixer.draft[id];delete CloudFixer.busy[id];CloudFixer.open=null;
  if(r.ok){CloudFixer.say[id]='Works: Anthropic started a test run.';toast('Cloud fixer connected')}else CloudFixer.say[id]='Saved, but the test did not work: '+(r.why||'no answer from Anthropic')+' Check the id and token, then press Remove and Connect again.';
  await cfRefresh(box)}
 catch(e){delete CloudFixer.busy[id];a.disabled=false;cfSay(box,id,e?.message||String(e))}};
ACT['cf-test']=async a=>{const box=cfBox(a),id=cfId(a),x=cfRowOf(a);if(!x)return;a.disabled=true;CloudFixer.busy[id]=1;cfSay(box,id,'Starting a test run…');
 try{const r=await post(UI,'/ui/cloud-fixer/test',{trigId:x.trigId});CloudFixer.say[id]=r.ok?'Works: Anthropic started a test run.':(r.why||'It did not work.');delete CloudFixer.busy[id];await cfRefresh(box)}
 catch(e){delete CloudFixer.busy[id];a.disabled=false;cfSay(box,id,e?.message||String(e))}};
ACT['cf-del']=async a=>{const box=cfBox(a),id=cfId(a);a.disabled=true;
 try{CloudFixer.d=await call('','/ui/cloud-fixer',{method:'PUT',body:{routines:cfKeep(id)}});CloudFixer.say[id]='';toast('Removed. That account is no longer used for fixes.');cloudBox(box)}catch(e){a.disabled=false;fail(e)}};
