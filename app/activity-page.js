/* ---------- System › Activity (7 Nov 2026, owner approved): the quiet log of everything that happened by itself and
   needs nobody: agents' own runs, silent fixes, restarts, model switches, setting changes. No badge, no ping. One row
   per problem: a problem that came back shows "since 14:02, 3 times" instead of a row per time. The bell holds only what
   needs you and what you started (news.mjs). Settings › Notifications has the optional evening line. ---------- */
const Activity={
 when:t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
 day:t=>{const d=new Date(t),n=new Date(),y=new Date(n-864e5);return d.toDateString()===n.toDateString()?'Today':d.toDateString()===y.toDateString()?'Yesterday':d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'short'})},
 row(x,i){const times=(x.count||1)>1?'since '+Activity.when(x.since||x.t)+', '+x.count+' times':Activity.when(x.t);
  return `<div class="row act-row" ${st(Math.min(i,12))}${x.go?` data-go="${esc(x.go)}" tabindex="0"`:''}><div class="main-c"><span class="ic ${esc(x.kind||'blue')}">${icon(x.icon||'clock',15)}</span><div class="txt"><b>${esc(x.title)}</b>${x.text?`<span>${esc(x.text)}</span>`:''}<small>${esc(times)}${x.resolved?' · over':''}</small></div></div></div>`}};
PAGES.activity=async(p,el)=>{const gone=pageTok(el);setActions('');
 el.innerHTML='<div id="actList"><div class="skel" style="height:160px;border-radius:18px"></div></div>';
 let d;try{d=await UI('/ui/activity')}catch(e){if(!gone())el.querySelector('#actList').innerHTML=alertBox(esc(e.message));return}if(gone())return;
 const l=d.items||[],box=el.querySelector('#actList');
 if(!l.length){box.innerHTML='<div class="empty">'+icon('check',22)+'<b>Nothing yet</b><span>Runs, fixes and restarts that need nobody show up here.</span></div>';return}
 let last='',h='',k=0;for(const x of l){const g=Activity.day(x.t);if(g!==last){if(h)h+='</div>';h+='<div class="group-label">'+esc(g)+'</div><div class="card list">';last=g}h+=Activity.row(x,k++)}
 box.innerHTML=h+'</div>';
 box.addEventListener('click',e=>{const r=e.target.closest('[data-go]');if(r)go(r.dataset.go)})};

// Settings › Notifications: the optional evening line in the bell (off by default)
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el);await settings(p,el,r);if(gone()||S.me?.admin===false||el.querySelector('#notifBox'))return;
 let v;try{v=await UI('/ui/notify-settings')}catch{return}if(gone()||!el.isConnected)return;
 const c=document.createElement('div');c.id='notifBox';c.className='panel card';c.style.marginBottom='16px';c.innerHTML=`<div class="tm-row"><div class="txt"><b>Evening summary</b><p>One line in the bell at 19:00, like “12 things fixed themselves today, nothing needs you”.</p></div>${toggle(v.daily,'Evening summary','id="notifDaily"')}</div>`;
 el.append(c);c.querySelector('#notifDaily').onchange=async e=>{const on=e.target.checked;try{await put(UI,'/ui/notify-settings',{daily:on});toast(on?'The evening summary is on.':'The evening summary is off.')}catch(er){e.target.checked=!on;fail(er)}}}}
