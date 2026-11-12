/* ---------- System › Activity (7 Nov 2026, owner approved): the quiet log of everything that happened by itself and
   needs nobody: agents' own runs, silent fixes, restarts, model switches, setting changes. No badge, no ping. One row
   per problem: a problem that came back shows "since 14:02, 3 times" instead of a row per time. The bell holds only what
   needs you and what you started (news.mjs). Settings › Notifications has the optional evening line. ---------- */
const Activity={
 when:t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
 day:t=>{const d=new Date(t),n=new Date(),y=new Date(n-864e5);return d.toDateString()===n.toDateString()?'Today':d.toDateString()===y.toDateString()?'Yesterday':d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'short'})},
 // 10 Nov 2026 audit: a failure (stopped connecting, failed, stopped) gets the warning tile, a recovery or a finished
 // run the calm green one; restarts and the rest keep the neutral tile
 FAIL:/\b(?:stopped connecting|is broken|is missing its tools|is down|stopped answering|keeps? (?:failing|dropping)|kept dropping|cannot start|does not start|failed|ran out of time|stopped a run|lost \()/i,
 OK:/\b(?:works again|working again|answers again|is back|back on|reconnected|fixed|finished|passed)\b/i,
 tone(x){return Activity.FAIL.test(x.title)?{kind:'warn',icon:'alert'}:Activity.OK.test(x.title)?{kind:'ok',icon:'check'}:{kind:x.kind||'blue',icon:x.icon||'clock'}},
 // a raw error ("ConnectionError: MCP server 'aqeelos-notify': both Streamable HTTP and SSE transports failed …") is never
 // the main line: a plain summary leads, the raw text waits behind Details
 RAW:/^\s*[A-Z]\w*(?:Error|Exception)\b|MCP server '|Traceback|transports failed|\bHTTP \d{3}\b|\bE(?:CONN\w+|TIMEDOUT|NOTFOUND)\b/,
 TOOL_NAMES:{notify:'notifications',code:'Code',files:'files',browser:'browser',memory:'memory',self:'own runs'},
 tool(t){const m=/tool server "([^"]+)"/.exec(t||'');if(!m)return'';const n=m[1].replace(/^(?:aqeelos|mcp)[-_]/i,'');return Activity.TOOL_NAMES[n.toLowerCase()]||n},
 plain(x){const ok=Activity.OK.test(x.title),t=Activity.tool(x.title);
  if(ok)return t?'Reconnected':'Back to normal';
  if(t)return 'Lost its '+t+' tool'+(/aqeelOS is fixing it/i.test(x.text)?'. aqeelOS is fixing it.':'');
  return 'Hit an error'},
 row(x,i){const times=(x.count||1)>1?'since '+Activity.when(x.since||x.t)+', '+x.count+' times':Activity.when(x.t),tn=Activity.tone(x),raw=x.text&&Activity.RAW.test(x.text);
  const text=!x.text?'':raw?`<span>${esc(Activity.plain(x))}</span><button type="button" class="act-more" aria-expanded="false">Details${icon('chevR',12)}</button><div class="act-raw"><div><div>${esc(x.text)}</div></div></div>`:`<span>${esc(x.text)}</span>`;
  return `<div class="row act-row${x.go?' rm':''}" ${st(Math.min(i,12))}><div class="main-c"><span class="ic ${esc(tn.kind)}">${icon(tn.icon,15)}</span><div class="txt"><b>${x.go?`<button type="button" class="row-main" data-go="${esc(x.go)}">${esc(agentText(x.title))}</button>`:esc(agentText(x.title))}</b>${text}<small>${esc(times)}${x.resolved?' · over':''}${x.ask?' · <span class="act-ask">asks you to act</span>':''}</small></div></div></div>`}};
PAGES.activity=async(p,el)=>{const gone=pageTok(el);setActions('');
 el.innerHTML='<div id="actList"><div class="skel" style="height:160px;border-radius:var(--r-md)"></div></div>';
 let d,iss=null;try{[d,iss]=await Promise.all([UI('/ui/activity'),S.me?.admin===false?null:UI('/ui/health/issues').catch(()=>null)])}catch(e){if(!gone())el.querySelector('#actList').innerHTML=alertBox(esc(e.message));return}if(gone())return;
 const l=d.items||[],box=el.querySelector('#actList');
 // the summary line counts what Health's Needs you counts (the same needGroups) plus the rows here that ask you to act, so it matches the list
 {const h=iss?HealthIssues.needGroups(iss.items||[]).length:0,m=l.filter(x=>x.ask).length,n=h+m,sub=document.querySelector('.page-head p');
  const where=m&&h?'the ones marked below, and '+h+' on System › Health':m?'marked below':'on System › Health';
  if(sub)sub.textContent='What happened by itself: runs, fixes, restarts. '+(n?(n===1?'1 thing asks you to act, ':n+' things ask you to act: ')+where+'.':'Nothing here needs you right now.')}
 if(!l.length){box.innerHTML='<div class="empty">'+icon('check',22)+'<b>Nothing yet</b><span>Runs, fixes and restarts that need nobody show up here.</span></div>';return}
 let last='',h='',k=0;for(const x of l){const g=Activity.day(x.t);if(g!==last){if(h)h+='</div>';h+='<div class="group-label">'+esc(g)+'</div><div class="card list">';last=g}h+=Activity.row(x,k++)}
 box.innerHTML=h+'</div>';
 box.addEventListener('click',e=>{const m=e.target.closest('.act-more');if(m){e.stopPropagation();const on=m.getAttribute('aria-expanded')!=='true';m.setAttribute('aria-expanded',String(on));m.nextElementSibling?.classList.toggle('open',on);return}
  if(e.target.closest('.act-raw.open'))return;const r=e.target.closest('[data-go]');if(r)go(r.dataset.go)})};

// Settings › Notifications: the optional evening line in the bell (off by default)
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el),pre=S.me?.admin===false?null:UI('/ui/notify-settings');pre?.catch(()=>{});await settings(p,el,r);if(gone()||!pre||el.querySelector('#notifBox'))return;   // asked with the page (install-page.js, 12 Nov 2026)
 let v;try{v=await pre}catch{return}if(gone()||!el.isConnected)return;
 const c=document.createElement('div');c.id='notifBox';c.className='panel card';c.style.marginBottom='16px';c.innerHTML=`<div class="tm-row"><div class="txt"><b>Evening summary</b><p>One line in the bell at 19:00, like “12 things fixed themselves today, nothing needs you”.</p></div>${toggle(v.daily,'Evening summary','id="notifDaily"')}</div>`;
 el.append(c);c.querySelector('#notifDaily').onchange=async e=>{const on=e.target.checked;try{await put(UI,'/ui/notify-settings',{daily:on});toast(on?'The evening summary is on.':'The evening summary is off.')}catch(er){e.target.checked=!on;fail(er)}}}}
