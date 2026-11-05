/* Channels › Connections: WhatsApp lines through Kirimdev (kirimdev.mjs, 5 Nov 2026), for admins. One row per line:
   who answers it, Test (only its testers get answers) or Live (every customer), and whether Kirimdev's messages arrive.
   Actions: Connect (makes the webhook at Kirimdev), Go live / Back to test. */
const Kirim={
 when:t=>{if(!t)return '';const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?tm:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+tm},
 async show(el){if(S.me?.admin===false)return;let d;try{d=await UI('/ui/kirimdev')}catch{return}
  const a=showingAll()?'':viewing();const lines=(d.lines||[]).filter(l=>!a||l.agent===a);
  let box=el.querySelector('.kd-box');if(!lines.length){box?.remove();return}
  if(!box){box=document.createElement('div');box.className='panel kd-box';el.append(box)}
  box.innerHTML=`<h2>WhatsApp through Kirimdev</h2>`+lines.map((l,i)=>`<div class="row" ${st(i)}><div class="main-c">${agentAvatar(l.agent,32)}<div class="txt"><b>${esc(l.persona)} · ${esc(l.business)}</b>
   <span>${l.mode==='live'?'Live: answers every customer.':'Test: answers only '+esc(l.testers.join(', ')||'its testers')+'.'} ${l.connected?(l.last?'Last message '+esc(Kirim.when(l.last))+'.':'Connected, no message yet.'):'Not connected: Kirimdev does not send it messages yet.'}</span></div></div>
   <div class="act">${l.connected?'':`<button class="primary" data-act="kd-connect" data-agent="${esc(l.agent)}">Connect</button>`}
   <button class="ghost" data-act="kd-mode" data-agent="${esc(l.agent)}" data-mode="${l.mode==='live'?'test':'live'}">${l.mode==='live'?'Back to test':'Go live'}</button></div></div>`).join('')}};
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if((S.tab.channels||'Connections')!=='Connections')return;Kirim.show(el)}}
ACT['kd-connect']=async b=>{b.disabled=true;try{await UI('/ui/kirimdev/connect',{method:'POST',body:{agent:b.dataset.agent}});toast('Connected. Kirimdev now sends this line’s messages here.');Kirim.show(b.closest('.kd-box').parentElement)}catch(e){b.disabled=false;toast(e.message||'Could not connect it')}};
ACT['kd-mode']=async b=>{const live=b.dataset.mode==='live';
 if(live&&!await confirmBox('Answer every customer?','From now on this agent answers every customer who writes to this WhatsApp number, not only the testers.','Go live',false))return;
 b.disabled=true;try{await UI('/ui/kirimdev/mode',{method:'POST',body:{agent:b.dataset.agent,mode:b.dataset.mode}});toast(live?'Live: it answers every customer now.':'Back to test: only testers get answers.');Kirim.show(b.closest('.kd-box').parentElement)}catch(e){b.disabled=false;toast(e.message||'Could not change it')}};
