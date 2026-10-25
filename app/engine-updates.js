// Automatic engine updates (25 Oct 2026), under Updates on System › Health: Off / Ask me first / Adaptive, the quiet hours
// aqeelOS found, what waits for tonight, and the last tries. Update now / Update tonight ask here too (engine-updates.mjs).
const EngUpd={last:null,
 MODES:[['off','Off'],['ask','Ask me first'],['adaptive','Adaptive']],
 TEXT:{off:'Updates only when you press Update.',ask:'aqeelOS tells you when a stable release is ready. Update tonight installs it in the quiet hours.',
  adaptive:'Installs each stable release once it is 3 days old, in the quiet hours, when nobody is chatting and no schedule is due. Every channel is checked after, and the engine goes back to its earlier version if something broke.'},
 when:t=>new Date(t).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),
 v:x=>x?'v'+String(x).replace(/^v/,''):'',
 line(e){const to=this.v(e.to),from=this.v(e.from);
  return e.kind==='updated'?'Updated to '+(to||'the new version')+', all checks passed':e.kind==='rolled-back'?'Rolled back to '+(from||'the earlier version')+(e.after?.length?', some checks still fail':', checks pass again'):e.kind==='check-failed'?'Updated to '+(to||'the new version')+', but checks failed':e.kind==='failed'?'Update'+(to?' to '+to:'')+' did not finish: '+e.reason:'Skipped'+(to?' '+to:'')+': '+e.reason},
 async card(b){if(!b||S.me?.admin===false)return;const tok=b._euTok=(b._euTok||0)+1;let d;try{d=this.last=await UI('/ui/engine-updates')}catch{return}if(tok!==b._euTok||!b.isConnected)return;
  let box=b.querySelector('.eu-card');if(box)box.innerHTML=this.html(d);else{box=document.createElement('div');box.className='panel card eu-card';box.innerHTML=this.html(d);b.append(box)}   // redrawn in place, no flash
  if(d.running)setTimeout(()=>{if(box.isConnected)this.card(b)},15000)},
 html(d){const w=d.window,run=d.running,log=d.log||[];
  return '<div class="bk-head"><div><h2>Automatic updates</h2><p class="sub">'+esc(this.TEXT[d.mode]||'')+'</p></div><div class="seg-mini" role="radiogroup" aria-label="Automatic updates">'+this.MODES.map(([k,l])=>'<button type="button" role="radio" aria-checked="'+(d.mode===k)+'" class="'+(d.mode===k?'on':'')+'" data-act="eu-mode" data-m="'+k+'">'+l+'</button>').join('')+'</div></div>'
   +'<div class="bk-rows">'+(w?'<div class="bk-row"><span class="bk-k">Quiet hours</span><span>Quietest: <b>'+esc(w.label)+'</b> · from the last 4 weeks of messages</span></div>':'')
   +(run?'<div class="bk-row"><span class="bk-k">Now</span><span><span class="spinner tiny"></span> '+esc(run.to?'Updating to '+this.v(run.to):'Updating')+' · '+esc(run.step)+'</span></div>'
    :d.tonight?'<div class="bk-row"><span class="bk-k">Tonight</span><span>Updates in the quiet hours'+(d.waiting?' · waiting: '+esc(d.waiting):'')+' <button class="link-btn" data-act="eu-tonight" data-on="0">Cancel</button></span></div>'
    :d.mode==='adaptive'&&d.waiting?'<div class="bk-row"><span class="bk-k">Tonight</span><span>Waiting: '+esc(d.waiting)+'</span></div>':'')
   +'<div class="bk-row"><span class="bk-k">Last tries</span><span class="eu-list">'+(log.length?log.slice(0,6).map(e=>'<span class="eu-log eu-'+esc(e.kind)+'"><span><b>'+esc(this.when(e.at))+'</b> · '+esc(this.line(e))+'</span>'+((e.problems||[]).length?'<small>'+esc(e.problems.slice(0,3).join('; '))+'</small>':'')+'</span>').join(''):'None yet')+'</span></div></div>'},
 // Update: tonight (in the quiet hours, checked after) or now; both check every channel after updating
 ask(a){const w=this.last?.window?.label||'the quiet hours',n=+a?.dataset.n||0;
  const {d,close}=stackPop('Update the aqeelOS engine?','<p style="margin:0;color:var(--ink-2);line-height:1.55"></p>','<button class="ghost" data-x>Cancel</button><button id="euNow">Update now</button><button class="primary" id="euTonight">Update tonight</button>');
  d.querySelector('p').textContent='Tonight installs it between '+w.replace('-',' and ')+' when nobody is chatting. Now pulls '+plural(n,'commit')+' and restarts the engine at once, so chats in progress may be interrupted. Either way every channel is checked after, and the engine goes back if something broke.';
  d.querySelector('#euTonight').onclick=async e=>{e.stopPropagation();close();try{this.last=await post(UI,'/ui/engine-updates/tonight',{on:true});toast('Updates tonight, '+w);this.card($('#updBox'))}catch(x){fail(x)}};
  d.querySelector('#euNow').onclick=async e=>{e.stopPropagation();close();await runAction('Updating aqeelOS','/hermes/update');this.card($('#updBox'))};
  setTimeout(()=>d.querySelector('#euTonight')?.focus(),30)}};
ACT['eu-mode']=async a=>{const m=a.dataset.m;if(EngUpd.last?.mode===m)return;try{EngUpd.last=await post(UI,'/ui/engine-updates/mode',{mode:m});toast(m==='off'?'Automatic updates off':m==='ask'?'aqeelOS asks first':'Adaptive updates on');EngUpd.card($('#updBox'))}catch(e){fail(e)}};
ACT['eu-tonight']=async a=>{try{EngUpd.last=await post(UI,'/ui/engine-updates/tonight',{on:a.dataset.on==='1'});toast(a.dataset.on==='1'?'Updates tonight':'Not tonight');EngUpd.card($('#updBox'))}catch(e){fail(e)}};
