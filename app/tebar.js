// Tebar webhook settings (11 Nov 2026, app/tebar.mjs): a section in the Tebar row's panel on Connections. It shows the
// address to give Tebar (Integrasi › Tambah webhook), takes the whsec_ secret Tebar shows once (never shown back), and the
// events to pass on. Failed posts and expired accounts become alerts; comments and DMs a notice in the owner's bell.
const TbHook={cache:{},
 is:r=>r?.kind==='mcp'&&r.type==='app'&&!r.own&&(r.logo==='tebar.app'||/^tebar(\b|[-_])/i.test(String(r.id||''))),
 agentOf:r=>r.owner||r.users?.[0]?.id||'default',
 // drawn with the panel (the last answer at once, then a fresh one)
 section(r){if(!this.is(r))return '';const a=this.agentOf(r);setTimeout(()=>this.load(a),0);
  return `<section class="cn-sec tb-hook" data-tb-agent="${esc(a)}"><h3>Tebar webhook <small class="hint">optional</small></h3><div class="tb-in">${this.cache[a]?this.html(this.cache[a]):'<p class="hint">Loading…</p>'}</div></section>`},
 async load(a){try{const v=await UI('/ui/tebar/hook?agent='+encodeURIComponent(a));this.cache[a]=v;this.fill(a)}catch(e){const box=this.box(a);if(box)box.innerHTML=`<p class="hint">${esc(e.message||'Could not load the Tebar webhook.')}</p>`}},
 box:a=>[...document.querySelectorAll('.tb-hook')].find(x=>x.dataset.tbAgent===a)?.querySelector('.tb-in'),
 fill(a){const box=this.box(a);if(box&&this.cache[a])box.innerHTML=this.html(this.cache[a])},
 html(v){const on=new Set(v.events),main=['post.failed','account.expired','account.disconnected','comment.created','message.received'];
  const line=e=>`<label class="cn-line tb-ev"><span class="cn-lt"><b>${esc(e.words)}</b><small>${esc(e.id)}</small></span>${toggle(on.has(e.id),e.words,`data-tb-ev="${esc(e.id)}"`)}</label>`;
  const recent=(v.recent||[]).slice(0,5);
  return `<p class="hint">Tebar tells ${esc(ident(v.agent).name)} when a post fails, an account needs signing in again, or a comment or DM comes in. In Tebar: Integrasi › Tambah webhook (turn on Developer mode), paste this address, pick the same events, then paste the secret it shows here.</p>
   ${v.reach?.ok?'':`<p class="hint cn-why">${icon('alert',12)} ${esc(v.reach?.why||'')}</p>`}
   <div class="cn-line"><span class="ic">${icon('link',15)}</span><span class="cn-lt"><b class="tb-url">${esc(v.url)}</b><small>The address for Tebar</small></span><button class="ghost small" data-act="tb-copy" data-url="${esc(v.url)}">${icon('copy',14)}Copy</button></div>
   <div class="cn-line"><span class="ic">${icon('key',15)}</span><span class="cn-lt"><b>${v.hasSecret?'Secret saved':'No secret yet'}</b><small>${v.hasSecret?'Paste a new one to replace it':'Tebar shows it once (whsec_…), when the webhook is made'}</small></span>${v.hasSecret?'<span class="chip ok"><i class="dot"></i>Saved</span>':''}</div>
   <div class="tb-sec"><input type="password" autocomplete="new-password" placeholder="whsec_…" aria-label="Tebar webhook secret" data-tb-secret="${esc(v.agent)}"><button class="small" data-act="tb-save" data-agent="${esc(v.agent)}">Save</button></div>
   <h3 class="tb-h">Events</h3><div class="cn-lines" data-tb-evs="${esc(v.agent)}">${v.all.filter(e=>main.includes(e.id)).map(line).join('')}</div>
   <details class="tb-more"><summary class="hint">More events</summary><div class="cn-lines" data-tb-evs="${esc(v.agent)}">${v.all.filter(e=>!main.includes(e.id)).map(line).join('')}</div></details>
   ${recent.length?`<h3 class="tb-h">Last events</h3><ul class="cn-recent">${recent.map(x=>`<li class="ca-a"><span class="ca-at"><b>${esc(x.type)}</b><small>${esc(ago(x.at/1000))}${x.picked?'':' · not picked, ignored'}</small></span></li>`).join('')}</ul>`:v.set?'<p class="hint">Nothing from Tebar yet. Send a test from Tebar (Integrasi, the webhook, Test).</p>':''}
   ${v.set?`<button class="ghost small cn-dis" data-act="tb-remove" data-agent="${esc(v.agent)}">${icon('trash',14)}Remove the webhook here</button>`:''}`},
 async save(a,body,ok){try{this.cache[a]=await post(UI,'/ui/tebar/hook',{agent:a,...body});this.fill(a);if(ok)toast(ok)}catch(e){fail(e);this.fill(a)}}};
ACT['tb-copy']=b=>copyText(b.dataset.url,'Address copied');
ACT['tb-save']=b=>{const a=b.dataset.agent,i=[...document.querySelectorAll('[data-tb-secret]')].find(x=>x.dataset.tbSecret===a),s=i?.value.trim();if(!s){i?.focus();return toast('Paste the secret Tebar showed (whsec_…).','err')}
 b.disabled=true;TbHook.save(a,{secret:s},'Tebar webhook secret saved')};
ACT['tb-remove']=b=>{b.disabled=true;UI('/ui/tebar/hook',{method:'DELETE',body:{agent:b.dataset.agent}}).then(()=>{delete TbHook.cache[b.dataset.agent];TbHook.load(b.dataset.agent);toast('Removed. Delete the webhook in Tebar too.')},e=>{b.disabled=false;fail(e)})};
// an event switched on or off: the whole list is saved
document.addEventListener('change',e=>{const t=e.target.closest?.('[data-tb-ev]');if(!t)return;const a=t.closest('[data-tb-evs]')?.dataset.tbEvs;if(!a)return;
 const l=[...document.querySelectorAll('.tb-hook [data-tb-ev]')].filter(x=>x.closest('[data-tb-evs]')?.dataset.tbEvs===a&&x.checked).map(x=>x.dataset.tbEv);
 if(!l.length){t.checked=true;return toast('Keep at least one event on, or remove the webhook.','err')}TbHook.save(a,{events:l})});
