// Bottlenecks: what is stuck until you act, with a fix for each (next to the bell). Since 7 Nov 2026 only what truly
// needs a person (the server filters, bottlenecks.mjs forPopup), each once, with what to do in one plain line (x.ask). aqeelOS adds what it notices (a
// sign-in that is due, a failed schedule, an expired invite, the server having been off); agents add what blocks them.
const Bottlenecks={items:[],
 async check(){if(!S.signedIn||document.hidden)return;try{const d=await UI('/ui/bottlenecks');this.items=d.items||[]}catch{return}this.paintCount()},
 paintCount(){const b=document.querySelector('[data-act="bottlenecks"]');if(!b)return;const n=this.items.length;b.hidden=false;b.classList.toggle('none',!n);b.toggleAttribute('data-none',!n);const c=b.querySelector('.bn-n');if(c)c.textContent=n>9?'9+':String(n||'')},
 icon:{cadence:'clock',design:'clock',conflict:'alert',instructions:'edit',access:'lock',signin:'key',account:'key',schedule:'clock',invite:'user',report:'alert',down:'activity',update:'refresh',ticket:'help',channel:'chat',system:'alert',stopped:'clock',group:'chat',dropped:'chat',handoff:'chat',customer:'chat',comment:'chat',unanswered:'chat',twice:'activity',skill:'edit',apps:'plug',alerts:'alert',question:'help'},
 // inside: an open Bottlenecks dialog to draw again in place (after Clear all), instead of closing and opening a new one
 async open(inside){await this.check();const nm=a=>typeof ident==='function'&&ident(a)?.name||a;const list=this.items.map(x=>x.agent?{...x,agentName:nm(x.agent),title:x.kind==='report'?nm(x.agent)+' is blocked: '+x.missing:x.title}:x);
  const body=list.length?'<div class="bn-list">'+list.map((x,i)=>'<div class="bn-item" data-agent="'+esc(x.agent||'')+'"><span class="bn-ic bn-'+esc(x.kind)+'">'+icon(this.icon[x.kind]||'alert',16)+'</span><div class="bn-t"><b>'+esc(x.title)+'</b>'+(x.count>1?'<small class="bn-c">reported '+x.count+' times</small>':'')+(x.text?'<p>'+esc(x.text)+'</p>':'')+(x.options?'<ul class="bn-opts">'+x.options.map(o=>'<li><b>'+esc(o.label)+'</b>'+(o.recommended?'<span class="bn-rec">Recommended</span>':'')+'<span>'+esc(o.effect)+'</span></li>').join('')+'</ul>':'')+(x.sides?'<ol class="bn-sides">'+x.sides.map(s=>'<li>'+esc(s.text||s.label)+'</li>').join('')+'</ol>':'')+(x.ask?'<p class="bn-ask"><b>What you need to do</b>'+esc(x.ask)+'</p>':'')+(x.purpose||x.from?'<div class="bn-whys">'+Why.rows(x,'bn-why')+'</div>':'')+'<div class="bn-acts" data-i="'+i+'"></div></div></div>').join('')+'</div>':'<div class="bn-empty">'+icon('check',22)+'<b>Nothing is stuck</b><p class="hint">Only what needs you shows up here: a payment, a login only you have, adding a bot to a group, or a decision. Everything else is fixed by itself'+(S.me?.admin!==false?' and shows on System › Health':'')+'.</p></div>';
  // 7 Nov 2026 (owner: "what is Got it even"): no pure acknowledge here, not even Clear all. Each item has the one button
  // that does the thing, and leaves by itself once the system sees it done; "Not now" only snoozes it until tomorrow.
  const foot='<button class="ghost" data-act="close">Close</button>';let d=inside;
  if(d?.isConnected){const bd=d.querySelector('.drawer-body'),ft=d.querySelector('.drawer-foot');bd.innerHTML=body;if(ft)ft.innerHTML=foot}else d=drawer('Bottlenecks',body,foot);
  Why.wire(d);
  d.querySelectorAll('.bn-acts').forEach(box=>this.paint(box,this.actions(list[+box.dataset.i]),async()=>{await this.check();if(this.items.length)this.open(d);else closeLayers()}))},
 // a schedule name on a button: no [tag] in front, cut at a word, never mid-word
 short(n){n=String(n||'').replace(/^\[[^\]]*\]\s*/,'');return n.length<=26?n:n.slice(0,26).replace(/\s+\S*$/,'').replace(/[:,;.]$/,'')+'…'},
 // acts: [label, run, primary]; only the first primary is drawn as one (one main button per item); run({box,after}) may turn the box into an inline field (a key, words) and call after() itself, then it returns a promise that never settles
 // a 4th entry {step,say,alt,done} (need-action.mjs): when a need has several steps they are a short numbered list, each
 // with its own line and its own button (and its alternative next to it); a step already done shows a tick and no button
 paint(box,acts,after){box.replaceChildren();let main=false;
  const mk=([label,run,pri])=>{const primary=pri&&!main;main||=!!pri;const b=document.createElement('button');b.type='button';b.className=primary?'primary small':'ghost small';b.textContent=label;b.title=label;b.onclick=async()=>{b.disabled=true;try{const r=await run({box,after,acts});if(r===false){b.disabled=false;return}await after()}catch(e){b.disabled=false;fail(e)}};return b};
  const nums=[...new Set(acts.filter(a=>a[3]?.step&&!a[3].alt).map(a=>a[3].step))],many=nums.length>1;
  if(many){const ol=document.createElement('ol');ol.className='bn-stepl';
   for(const n of nums){const mine=acts.filter(a=>a[3]?.step===n),head=mine.find(a=>!a[3].alt)||mine[0],li=document.createElement('li');if(head[3].done)li.className='done';
    const num=document.createElement('i');num.className='bn-num';if(head[3].done)num.innerHTML=icon('check',12);else num.textContent=n;const say=document.createElement('span');say.className='bn-say';say.textContent=head[3].say||head[0];
    const bs=document.createElement('span');bs.className='bn-sbtns';for(const a of mine)if(!a[3].done)bs.append(mk(a));li.append(num,say,bs);ol.append(li)}
   box.append(ol)}
  const row=document.createElement('div');row.className='bn-row';for(const a of acts)if(!a[3]?.done&&!(many&&a[3]?.step))row.append(mk(a));if(row.childElementCount)box.append(row)},
 // the server's acts of a need as buttons: [label, run, primary, {step,say,alt,done}]
 needBtns(acts,x){const first=acts.find(a=>a.do!=='done'&&!a.alt);return acts.map(a=>[a.label,()=>this.act(a,x),a===first,a.step?{step:a.step,say:a.say,alt:!!a.alt,done:a.do==='done'}:null])},
 // a small inline field in the item itself: placeholder text, the button's label, what saving does; Cancel puts the buttons back
 field({box,after,acts},{ph,go,secret,rows},save){box.innerHTML='<div class="bn-in">'+(rows?'<textarea rows="2" maxlength="400" placeholder="'+esc(ph)+'"></textarea>':'<input type="'+(secret?'password':'text')+'" autocomplete="off" spellcheck="false" placeholder="'+esc(ph)+'">')+'<button type="button" class="primary small">'+esc(go)+'</button><button type="button" class="ghost small">Cancel</button></div>';
  const [ok,no]=box.querySelectorAll('button'),inp=box.querySelector('input,textarea');inp.focus();no.onclick=()=>this.paint(box,acts,after);
  const run=async()=>{const v=inp.value.trim();if(!v){inp.focus();return}ok.disabled=true;try{await save(v);await after()}catch(e){ok.disabled=false;fail(e)}};ok.onclick=run;inp.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();run()}};return new Promise(()=>{})},
 // one act the server worked out for a need (need-action.mjs): starts the sign-in or opens the exact place, right here
 act(a,x){const away=f=>{closeLayers();f();return new Promise(()=>{})};
  switch(a.do){
   case 'signin-app':return away(()=>Signins.go({agent:a.agent,name:a.name,label:a.app,agentName:typeof ident==='function'?ident(a.agent)?.name:a.agent}));
   case 'signin-account':return away(()=>Pages.reconnect(a.key,a.name));
   // the stated alternative to signing in again: agents stop trying this account (it stays connected; Models puts it back)
   case 'unlist-account':return confirmBox('Take '+a.name+' out of the priority list?','Agents stop trying '+a.name+'. It stays on Models › AI accounts, where you can sign in to it later and put it back in the list.','Take it out',false).then(ok=>ok?post(UI,'/ui/accounts/unlist',{key:a.key}).then(()=>{toast(a.name+' is out of the priority list')}):false);
   // an app entry that can never work (a Google file link added as an app): removed from that agent, as its Connections panel does
   case 'remove-app':return confirmBox('Remove '+(a.app||a.name)+' from '+(typeof ident==='function'?ident(a.agent)?.name:a.agent)+'?','That agent stops trying to use it. Nothing else changes.','Remove').then(ok=>ok?del(H,'/mcp/servers/'+encodeURIComponent(a.name)+'?profile='+encodeURIComponent(a.agent)).then(()=>{toast((a.app||a.name)+' removed')}):false);
   case 'google':return away(()=>GC.open({agent:a.agent}));
   case 'screen':return away(()=>openAgentScreen(a.agent));
   case 'copy':return navigator.clipboard.writeText(a.cmd).then(()=>toast('Copied · run it on the server, then press Check again'),()=>{throw new Error('Could not copy. The command is: '+a.cmd)});
   case 'go':return away(()=>{if(a.tab)S.tab[a.tab[0]]=a.tab[1];go(a.to)});
   case 'done':return Promise.resolve(false);
   case 'recheck':return post(UI,'/ui/health/issues/retry',{id:x.id}).then(()=>toast('Checking it again'));
   default:throw new Error('Unknown action')}},
 // a question (questions.mjs): one button per option, the recommended one first and primary; Something else takes words
 questionActs(x,done){const send=(choice,text)=>post(UI,'/ui/questions/answer',{qid:x.qid,choice,text}).then(r=>{toast('Answered: '+r.answer)});
  const opts=[...x.options].sort((p,q)=>(q.recommended?1:0)-(p.recommended?1:0)),out=opts.map((o,i)=>[o.label,o.go?()=>{closeLayers();go(o.go);return new Promise(()=>{})}:()=>send(o.key),i===0]);
  if(x.allowOther!==false)out.push(['Something else',({box,after,acts})=>this.field({box,after,acts},{ph:'What should happen instead?',go:'Send',rows:true},v=>send('other',v))]);return out},
 actions(x){const ids=[x.id,...(x.also||[])],done=()=>Promise.all(ids.map(id=>post(UI,'/ui/bottlenecks/done',{id}))),later=()=>Promise.all(ids.map(id=>post(UI,'/ui/bottlenecks/later',{id}))).then(()=>toast('Hidden until tomorrow'));
  // an AI account signed out: the same Reconnect as its card on Models (the item goes once it works again)
  if(x.kind==='question')return this.questionActs(x);
  if(x.kind==='account'){const s=x.account.state;if(s==='exhausted'||s==='credit')return [['Add an account',()=>{closeLayers();Connect.add();return new Promise(()=>{})},true],['Not now',later]];
   return [[s==='rejected'?'Paste a new key':'Sign in again',()=>{closeLayers();Pages.reconnect(x.account.key,x.account.name);return new Promise(()=>{})},true],['Not now',later]]}
  // the fixer needs its GitHub token (issues.mjs): a field right here, saved on the server
  if(x.kind==='github_token')return [['Paste the token',c=>this.field(c,{ph:'github_pat_…',go:'Save token',secret:true},async v=>{await post(UI,'/ui/health/fixer-token',{token:v});toast('Saved · the fixer opens its pull requests')}),true],['Not now',later]];
  // a need the server worked out a direct button for (a sign-in to an app or account, Google, the agent's screen): that is the primary
  if(x.acts?.length&&['report','alerts','apps'].includes(x.kind)){const rest=x.kind==='report'?[['Ask '+(x.agentName||'the agent')+' to retry',()=>this.retryReport(x,done),false]]:[];return [...this.needBtns(x.acts,x),...rest,['Not now',later]]}
  // an agent's new instructions wait for approval: review the before/after in Edit agent › History
  if(x.kind==='instructions')return [['Read the changes',()=>{closeLayers();editAgent(x.agent,'History');return new Promise(()=>{})},true]];
  if(x.kind==='signin')return [['Sign in to '+(x.signin?.app||x.signin?.label||x.signin?.name||'it'),()=>{closeLayers();Signins.open(x.signin);return new Promise(()=>{})},true],['Not now',later]];
  // a schedule that starts the AI every few minutes with no check (run-gates.mjs): per schedule, Add a check (when a standard one fits) or Keep every N min
  if(x.kind==='cadence')return x.jobs.flatMap(j=>{const n=(x.jobs.length>1?' · '+Bottlenecks.short(j.name):'');return [...(j.suggest?[['Add a check'+n,async()=>{await post(UI,'/ui/run-gates/decide',{agent:x.agent,job:j.job,choice:'check'});toast('Check added · it looks at '+j.suggest.what+' before each start')},true]]:[]),['Keep every '+j.every+' min'+n,async()=>{await post(UI,'/ui/run-gates/decide',{agent:x.agent,job:j.job,choice:'keep'});toast('Kept as it is')},!j.suggest]]});
  // schedules that mostly woke the AI for nothing (design-guard.mjs): per schedule, the better design where a button can apply it; else
  // Make it a check (and Start it from an event where one fits): the agent is asked in a new chat, with the exact call (13 Nov 2026: the
  // owner's card for Donna AI's "Master To Do sync" had only Keep as it is); or Keep as it is
  if(x.kind==='design')return x.jobs.flatMap(j=>{const n=(x.jobs.length>1?' · '+Bottlenecks.short(j.name):'');
   const ask=(choice,label,primary)=>[label+n,()=>this.askDesign(x,j,choice),primary];
   return [...(j.mechanical?[[j.label+n,async()=>{await post(UI,'/ui/design-guard/decide',{agent:x.agent,job:j.job,choice:'apply'});toast(j.how==='script'?'Done · it runs as a script with no AI now':'Done · a check runs before each start now')},true]]
    :[ask('check',j.checked?'Ask for a sharper check':'Make it a check',true),...(j.events?.length?[ask('event','Start it from an event',false)]:[])]),
    ['Keep as it is'+n,async()=>{await post(UI,'/ui/design-guard/decide',{agent:x.agent,job:j.job,choice:'keep'});toast('Kept as it is')},false]]});
  // a conflict: one button per side, and Something else (a number for timing and limits, else the words)
  if(x.kind==='conflict')return [...x.sides.map((s,i)=>[(x.sides.length>1?String.fromCharCode(65+i)+': ':'')+s.label.slice(0,48),async()=>{await post(UI,'/ui/conflicts/decide',{cid:x.cid,choice:s.key});toast('Done · the other versions are removed')},false]),['Something else',async()=>{const v=await promptBox('Something else','What should count instead?','','Choose');if(v==null||!v.trim())return;await post(UI,'/ui/conflicts/decide',{cid:x.cid,choice:'other',text:v.trim(),value:/^[0-9]+$/.test(v.trim())?+v.trim():undefined});toast('Done')}]];
  if(x.kind==='access')return S.me?.admin===false?[]:[['Allow',async()=>{await post(UI,'/ui/access/decide',{rid:x.rid,ok:true});toast(x.agentName+' can use it · ready in about a minute')},true],['Decline',async()=>{await post(UI,'/ui/access/decide',{rid:x.rid,ok:false});toast('Declined')}]];
  if(x.kind==='schedule')return [['Run again',async()=>{await post(H,'/cron/jobs/'+encodeURIComponent(x.job.id)+'/trigger?profile='+encodeURIComponent(x.agent));RanNow.mark(x.job.name);await done();toast('Running again')},true],['Open schedules',()=>{closeLayers();go('/automations/schedules');return new Promise(()=>{})}],['Not now',later]];
  if(x.kind==='invite')return [['Make a new link',async()=>{const i=x.invite;const r=await post(UI,'/ui/people/invite',{name:i.name,role:i.role,roleId:i.roleId,caps:i.caps,agents:i.agents,ownAgent:i.ownAgent});const link=location.origin+'/#invite/'+r.code;await navigator.clipboard.writeText(link).catch(()=>{});await done();toast('New invite link copied · valid for 7 days')},true],['Not now',later]];
  if(x.kind==='report')return [['Ask '+(x.agentName||'the agent')+' to retry',()=>this.retryReport(x,done),true],['Not now',later]];
  // the automations guard (automation-guard.mjs) found or fixed a tool server: its card is on System › Health

  // a login acting as the owner that no agent registered (connected-accounts.mjs): approved or disconnected on its page
  // 7 Nov 2026: two real buttons that act here; the item leaves at once (the owner's own logins never get here)
  if(x.kind==='accounts'){const id=x.data?.account;if(!id)return [['Open Connections',()=>{closeLayers();go('/abilities/connections');return new Promise(()=>{})},true],['Not now',later]];
   return [['Keep it',async()=>{await post(UI,'/ui/connected-accounts/approve',{id});await done();toast('Kept · it shows under Connections')},true],
    ['Disconnect',async()=>{if(!await confirmBox('Disconnect '+(x.data.label||'this login')+'?','Every agent loses it at once and the saved sign-in is deleted. To use it again, someone has to sign in again.','Disconnect'))return;await post(UI,'/ui/connected-accounts/disconnect',{id});await done();toast('Disconnected')}]]}
  // apps that wait for a sign-in, asked by one or more agents (merged): Connected apps, where they are signed in or switched off
  if(x.kind==='apps')return [['Open Connected apps',()=>{closeLayers();go('/abilities/mcp');return new Promise(()=>{})},true],['Not now',later]];
  // a channel that logged out or keeps failing (server.mjs channelAttention): Link again for WhatsApp, else its page
  if(x.kind==='channel'){const c=x.channel||{};return [c.id==='whatsapp'&&c.needs_link?['Link again',()=>{closeLayers();ACT['wa-link']({dataset:{agent:c.agent}});return new Promise(()=>{})},true]:['Reconnect it',async()=>{await post(UI,'/ui/channels/reconnect',{agent:c.agent,platform:String(c.id).split('-')[0]});toast('Reconnecting')},true],['Not now',later]]}
  // a Kirimdev line (kirimdev.mjs: the API key, the API, the webhook): its own page, not the WhatsApp channel's
  if(x.kind==='kirimdev'&&!x.info)return [['Open Kirimdev',()=>{closeLayers();go('/channels/kirimdev');return new Promise(()=>{})},true],['Not now',later]];
  // health checks (agent-health.mjs): a system problem an agent reported, schedules that stopped, a bot removed from a
  // Telegram group, messages that keep failing
  // an agent's system report: an issue for the fixer, which says on Health where it is; nothing to press
  if(x.kind==='system')return [];
  if(x.kind==='stopped')return [['Open schedules',()=>{closeLayers();go('/automations/schedules');return new Promise(()=>{})},true],['Not now',later]];
  if(x.kind==='group'){const g=(x.title||'').replace(/^Removed from the Telegram group /,'')||'the group';return [['Add the bot to '+g,()=>this.addBot(x,g),true],['Not now',later]]}
  // Help tickets (help.mjs) are read and resolved on Help › Tickets; here is only the pointer while some wait (1 Nov 2026)
  if(x.kind==='ticket')return [['Answer the tickets',()=>{closeLayers();go('/help/admin');return new Promise(()=>{})},true]];
  // a message for the owner (the fixer's "needs a person", when no channel is set): once done, the fixer tries again
  if(x.kind==='alerts'){const id=/\bissue (i[0-9a-f]{8})\b/.exec(x.title+' '+x.text)?.[1];return id?[['Try the fix again',async()=>{await post(UI,'/ui/health/issues/retry',{id});await done();toast('The fixer tries again.')},true],['Not now',later]]:[['Open Health',()=>{closeLayers();go('/system/health');return new Promise(()=>{})},true],['Not now',later]]}
  // anything else is in the fixer's hands (System › Health): nothing to press
  return []},
 // the agent's chat, with the message that asks it to try again
 // the request comes from the server (design-guard.mjs askFor) and is sent as the owner's message in a new chat with that agent, the main one too
 askDesign(x,j,choice){return (async()=>{const r=await post(UI,'/ui/design-guard/decide',{agent:x.agent,job:j.job,choice});closeLayers();
  if((S.profile||'default')!==r.agent&&typeof switchAgent==='function')switchAgent(r.agent);Chat.newChat();setTimeout(()=>Chat.send(r.ask),1500);
  toast('Asked '+(x.agentName||'the agent')+' in a new chat');return new Promise(()=>{})})()},
 retryReport(x,done){return (async()=>{await done();closeLayers();if((S.profile||'default')!==x.agent&&typeof switchAgent==='function')switchAgent(x.agent);go(x.from?.chat?'/chat/'+x.from.chat:'/chat');setTimeout(()=>{const t=document.querySelector('.composer textarea');if(t){t.value='That should be fixed now: '+x.title.replace(/^.*? is blocked: /,'')+'. Please try again.';t.dispatchEvent(new Event('input'));t.focus()}},600);return new Promise(()=>{})})()},
 // the exact steps to add a bot back to a Telegram group; the item leaves by itself once Health sees the bot there again
 addBot(x,g){const bot=x.data?.bot?'@'+x.data.bot:'the agent’s bot';closeLayers();
  drawer('Add the bot to '+g,'<ol class="bn-steps"><li>Open Telegram on your phone and go to the group <b>'+esc(g)+'</b>.</li><li>Tap the group name at the top, then <b>Add members</b>.</li><li>Search for <b>'+esc(bot)+'</b> and add it.</li><li>If it must read every message in the group, make it an admin.</li></ol><p class="hint">aqeelOS checks the group again within the hour; this item then leaves by itself.</p>',
   '<button class="primary" data-act="close">Close</button>');return new Promise(()=>{})}};
ACT['bottlenecks']=()=>Bottlenecks.open();
Poll.add(()=>Bottlenecks.check(),120000,2500);
