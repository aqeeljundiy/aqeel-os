// Bottlenecks: what is stuck until you act, with a fix for each (next to the bell). Since 7 Nov 2026 only what truly
// needs a person (the server filters, bottlenecks.mjs forPopup), each once, with what to do in one plain line (x.ask). aqeelOS adds what it notices (a
// sign-in that is due, a failed schedule, an expired invite, the server having been off); agents add what blocks them.
const Bottlenecks={items:[],
 async check(){if(!S.signedIn||document.hidden)return;try{const d=await UI('/ui/bottlenecks');this.items=d.items||[]}catch{return}this.paintCount()},
 paintCount(){const b=document.querySelector('[data-act="bottlenecks"]');if(!b)return;const n=this.items.length;b.hidden=false;b.classList.toggle('none',!n);b.toggleAttribute('data-none',!n);const c=b.querySelector('.bn-n');if(c)c.textContent=n>9?'9+':String(n||'')},
 icon:{instructions:'edit',access:'lock',signin:'key',account:'key',schedule:'clock',invite:'user',report:'alert',down:'activity',ticket:'help',channel:'chat',system:'alert',stopped:'clock',group:'chat',dropped:'chat',handoff:'chat',comment:'chat',unanswered:'chat',twice:'activity',skill:'edit',apps:'plug',alerts:'alert'},
 // inside: an open Bottlenecks dialog to draw again in place (after Clear all), instead of closing and opening a new one
 async open(inside){await this.check();const nm=a=>typeof ident==='function'&&ident(a)?.name||a;const list=this.items.map(x=>x.agent?{...x,agentName:nm(x.agent),title:x.kind==='report'?nm(x.agent)+' is blocked: '+x.missing:x.title}:x);
  const body=list.length?'<div class="bn-list">'+list.map((x,i)=>'<div class="bn-item" data-agent="'+esc(x.agent||'')+'"><span class="bn-ic bn-'+esc(x.kind)+'">'+icon(this.icon[x.kind]||'alert',16)+'</span><div class="bn-t"><b>'+esc(x.title)+'</b>'+(x.count>1?'<small class="bn-c">reported '+x.count+' times</small>':'')+(x.text?'<p>'+esc(x.text)+'</p>':'')+(x.ask?'<p class="bn-ask"><b>What you need to do</b>'+esc(x.ask)+'</p>':'')+(x.purpose||x.from?'<div class="bn-whys">'+Why.rows(x,'bn-why')+'</div>':'')+'<div class="bn-acts" data-i="'+i+'"></div></div></div>').join('')+'</div>':'<div class="bn-empty">'+icon('check',22)+'<b>Nothing is stuck</b><p class="hint">Only what needs you shows up here: a payment, a login only you have, adding a bot to a group, or a decision. Everything else is fixed by itself and shows on System › Health.</p></div>';
  // 7 Nov 2026 (owner: "what is Got it even"): no pure acknowledge here, not even Clear all. Each item has the one button
  // that does the thing, and leaves by itself once the system sees it done; "Not now" only snoozes it until tomorrow.
  const foot='<button class="ghost" data-act="close">Close</button>';let d=inside;
  if(d?.isConnected){const bd=d.querySelector('.drawer-body'),ft=d.querySelector('.drawer-foot');bd.innerHTML=body;if(ft)ft.innerHTML=foot}else d=drawer('Bottlenecks',body,foot);
  Why.wire(d);
  d.querySelectorAll('.bn-acts').forEach(box=>{const x=list[+box.dataset.i];for(const [label,run,primary] of this.actions(x)){const b=document.createElement('button');b.type='button';b.className=primary?'primary small':'ghost small';b.textContent=label;b.onclick=async()=>{try{await run();await this.check();if(this.items.length)this.open(d);else closeLayers()}catch(e){fail(e)}};box.append(b)}})},
 actions(x){const ids=[x.id,...(x.also||[])],done=()=>Promise.all(ids.map(id=>post(UI,'/ui/bottlenecks/done',{id}))),later=()=>Promise.all(ids.map(id=>post(UI,'/ui/bottlenecks/later',{id}))).then(()=>toast('Hidden until tomorrow'));
  // an AI account signed out: the same Reconnect as its card on Models (the item goes once it works again)
  if(x.kind==='account')return [['Reconnect',()=>{closeLayers();Pages.reconnect(x.account.key,x.account.name);return new Promise(()=>{})},true],['Not now',later]];
  // an agent's new instructions wait for approval: review the before/after in Edit agent › History
  if(x.kind==='instructions')return [['Review',()=>{closeLayers();editAgent(x.agent,'History');return new Promise(()=>{})},true]];
  if(x.kind==='signin')return [['Sign in to '+(x.signin?.app||x.signin?.label||x.signin?.name||'it'),()=>{closeLayers();Signins.open(x.signin);return new Promise(()=>{})},true],['Not now',later]];
  if(x.kind==='access')return S.me?.admin===false?[['Waiting for an admin',async()=>{},false]]:[['Allow',async()=>{await post(UI,'/ui/access/decide',{rid:x.rid,ok:true});toast(x.agentName+' can use it · ready in about a minute')},true],['Decline',async()=>{await post(UI,'/ui/access/decide',{rid:x.rid,ok:false});toast('Declined')}]];
  if(x.kind==='schedule')return [['Run again',async()=>{await post(H,'/cron/jobs/'+encodeURIComponent(x.job.id)+'/trigger?profile='+encodeURIComponent(x.agent));await done();toast('Running again')},true],['Open schedules',()=>{closeLayers();go('/automations/schedules');return new Promise(()=>{})}],['Not now',later]];
  if(x.kind==='invite')return [['Make a new link',async()=>{const i=x.invite;const r=await post(UI,'/ui/people/invite',{name:i.name,role:i.role,roleId:i.roleId,caps:i.caps,agents:i.agents,ownAgent:i.ownAgent});const link=location.origin+'/#invite/'+r.code;await navigator.clipboard.writeText(link).catch(()=>{});await done();toast('New invite link copied · valid for 7 days')},true],['Not now',later]];
  if(x.kind==='report')return [['I did it, ask '+x.agentName+' to try again',async()=>{await done();closeLayers();if((S.profile||'default')!==x.agent&&typeof switchAgent==='function')switchAgent(x.agent);go(x.from?.chat?'/chat/'+x.from.chat:'/chat');setTimeout(()=>{const t=document.querySelector('.composer textarea');if(t){t.value='That should be fixed now: '+x.title.replace(/^.*? is blocked: /,'')+'. Please try again.';t.dispatchEvent(new Event('input'));t.focus()}},600);return new Promise(()=>{})},true],['Not now',later]];
  // the automations guard (automation-guard.mjs) found or fixed a tool server: its card is on System › Health

  // a login acting as the owner that no agent registered (connected-accounts.mjs): approved or disconnected on its page
  if(x.kind==='accounts')return [['Approve or disconnect it',()=>{closeLayers();go('/abilities/connections');return new Promise(()=>{})},true],['Not now',later]];
  // apps that wait for a sign-in, asked by one or more agents (merged): Connected apps, where they are signed in or switched off
  if(x.kind==='apps')return [['Sign in to '+x.title.replace(/ needs? a sign-in$/,''),()=>{closeLayers();go('/abilities/mcp');return new Promise(()=>{})},true],['Not now',later]];
  // a channel that logged out or keeps failing (server.mjs channelAttention): Link again for WhatsApp, else its page
  if(x.kind==='channel'){const c=x.channel||{};return [c.id==='whatsapp'&&c.needs_link?['Link again',()=>{closeLayers();ACT['wa-link']({dataset:{agent:c.agent}});return new Promise(()=>{})},true]:['Open Channels',()=>{closeLayers();go('/channels/channels');return new Promise(()=>{})},true],['Not now',later]]}
  // a Kirimdev line (kirimdev.mjs: the API key, the API, the webhook): its own page, not the WhatsApp channel's
  if(x.kind==='kirimdev'&&!x.info)return [['Open Kirimdev',()=>{closeLayers();go('/channels/kirimdev');return new Promise(()=>{})},true],['Not now',later]];
  // health checks (agent-health.mjs): a system problem an agent reported, schedules that stopped, a bot removed from a
  // Telegram group, messages that keep failing
  // an agent's system report: an issue for the fixer, which says on Health where it is; nothing to press
  if(x.kind==='system')return [];
  if(x.kind==='stopped')return [['Open schedules',()=>{closeLayers();go('/automations/schedules');return new Promise(()=>{})},true],['Not now',later]];
  if(x.kind==='group'){const g=(x.title||'').replace(/^Removed from the Telegram group /,'')||'the group';return [['Add the bot to '+g,()=>this.addBot(x,g),true],['Not now',later]]}
  // Help tickets (help.mjs) are read and resolved on Help › Tickets; here is only the pointer while some wait (1 Nov 2026)
  if(x.kind==='ticket')return [['Open Help tickets',()=>{closeLayers();go('/help/admin');return new Promise(()=>{})},true]];
  // a message for the owner (the fixer's "needs a person", when no channel is set): once done, the fixer tries again
  if(x.kind==='alerts'){const id=/\bissue (i[0-9a-f]{8})\b/.exec(x.title+' '+x.text)?.[1];return id?[['I did it, try the fix again',async()=>{await post(UI,'/ui/health/issues/retry',{id});await done();toast('The fixer tries again.')},true],['Not now',later]]:[['Not now',later]]}
  // anything else is in the fixer's hands (System › Health): nothing to press
  return []},
 // the exact steps to add a bot back to a Telegram group; the item leaves by itself once Health sees the bot there again
 addBot(x,g){const bot=x.data?.bot?'@'+x.data.bot:'the agent’s bot';closeLayers();
  drawer('Add the bot to '+g,'<ol class="bn-steps"><li>Open Telegram on your phone and go to the group <b>'+esc(g)+'</b>.</li><li>Tap the group name at the top, then <b>Add members</b>.</li><li>Search for <b>'+esc(bot)+'</b> and add it.</li><li>If it must read every message in the group, make it an admin.</li></ol><p class="hint">aqeelOS checks the group again within the hour; this item then leaves by itself.</p>',
   '<button class="primary" data-act="close">Close</button>');return new Promise(()=>{})}};
ACT['bottlenecks']=()=>Bottlenecks.open();
Poll.add(()=>Bottlenecks.check(),120000,2500);
