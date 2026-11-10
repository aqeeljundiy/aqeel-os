// One way to show shared things (10 Nov 2026, owner: "connections is the best… make it coherent"): Skills and Plugins
// list what is installed exactly like Connections does: what it is, Belongs to, Who can use (a small stack of faces) and
// its status, one line each however many agents there are. A row opens the same panel as on Connections, as a pop-up in
// the middle of the screen. The Connections data (/ui/connections) already has every skill and plugin with its agents.
// Loaded last, so these Installed tabs replace the older lists; the other tabs (Tool groups, Find more, Browse) stay.
const UL={at:0,
 // the list for one kind, in el; agent: only rows that agent has (one agent showing), or null for every agent;
 // filter: which rows of that kind (Keys leaves out chat bot tokens); cache: reuse a list read in the last 15 s (a page
 // that draws itself again, such as a search on Keys, then shows it at once without the rows coming in again)
 async show(el,kind,{agent=null,noun,empty,filter=null,cache=false}={}){const gone=pageTok(el),warm=cache&&Pages._cx&&Date.now()-this.at<15000;
  el.insertAdjacentHTML('beforeend',`<div class="ul-host">${warm?'':skeletonRows(6)}</div>`);const host=el.querySelector('.ul-host');
  let d;if(warm)d=Pages._cx;else{try{d=await UI('/ui/connections');this.at=Date.now()}catch(e){if(!gone())host.innerHTML=errLine('the list of '+noun);return}if(gone())return}
  Pages._cx=d;Pages._cxEl=host;Cx.fixed={type:kind,agent,filter};S.cxQ='';
  const n=d.rows.filter(r=>r.type===kind&&(!filter||filter(r))&&(!agent||r.users.some(u=>u.id===agent&&u.level!=='off'))).length;
  // a panel left open over a page that drew itself again (a key changed or removed): fresh data, or closed when it is gone
  if(Cx.d?.isConnected&&Cx.key){if(Cx.row(Cx.key))Cx.detail(Cx.key);else closeLayers()}
  if(!n){host.innerHTML=emptyBox(empty[0],empty[1]);return}
  host.innerHTML=`<div class="toolbar cn-bar"><div class="search">${icon('search',16)}<input id="cnQ" type="search" enterkeyhint="search" placeholder="Search ${esc(plural(n,noun))}" aria-label="Search ${esc(noun)}s"><button class="ghost icon s-clear" data-act="cn-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div></div>
   <div class="card list cn-list"><div class="cn-head" aria-hidden="true"><span>${esc(noun[0].toUpperCase()+noun.slice(1))}</span><span>Belongs to</span><span>Who can use</span><span>Status</span></div><div class="cn-rows"></div></div>
   <p class="hint cn-foot">${d.canEdit?'Click a row to see who can use it and change it.':'You see the agents you use. An admin decides who can use what; you can ask for access from a row.'}</p>`;
  Cx.paintList(host,!warm);
  const q=host.querySelector('#cnQ');let t;q.oninput=()=>{q.closest('.search').classList.toggle('has-q',!!q.value);clearTimeout(t);t=setTimeout(()=>{if(!host.isConnected)return;S.cxQ=q.value;Cx.paintList(host)},120)}}};

// Skills › Installed
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{if((S.tab.skills||'Installed')!=='Installed'){Cx.fixed=null;return base(p,el)}
 setActions(`<button data-act="sk-update">${icon('refresh',16)}Update all</button><button data-act="sk-learn">${icon('wand',16)}Learn a skill</button><button class="primary" data-act="sk-new">${icon('plus',16)}New skill</button>`);
 el.innerHTML=tabs('skills',['Installed','Tool groups','Find more skills']);
 await UL.show(el,'skill',{agent:showingAll()?null:viewing(),noun:'skill',empty:['No skills yet','Learn a skill or find one under Find more skills.']})}}
// Plugins › Installed
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{if((S.tab.plugins||'Installed')!=='Installed'){Cx.fixed=null;return base(p,el)}
 setActions(`<button data-act="pl-rescan">${icon('refresh',16)}Rescan</button>`);
 el.innerHTML=tabs('plugins',['Installed','Browse']);
 await UL.show(el,'plugin',{agent:showingAll()?null:viewing(),noun:'plugin',empty:['No plugins turned on','Find one under Browse.']})}}
// on Connections itself nothing is fixed
{const base=PAGES.connections;PAGES.connections=async(p,el)=>{Cx.fixed=null;return base(p,el)}}

// System › Keys (10 Nov 2026): the keys are the Connections table for keys, one line each (a friendly name, Belongs to,
// Who can use, Saved); a row opens the key's panel, which also says which account it is (keys-identity.js) and has
// Change the value and Remove. Every agent: the table alone. One agent: the keys it can use, then the services to add a
// key for (pages.js), then what other agents have (access-ask.js). Chat bot tokens live with their channel.
const ulKeyOnly=r=>!r.bot&&!/^(TELEGRAM|WHATSAPP|SLACK|DISCORD|SIGNAL|MATTERMOST|MATRIX|SMS|TWILIO|EMAIL|WEIXIN|QQ|BUZZ|TEAMS)_/.test(String(r.id).split('@')[0]);
{const base=PAGES.keys;PAGES.keys=async(p,el,r)=>{if(S.me?.admin===false){Cx.fixed=null;return base(p,el,r)}const gone=pageTok(el);
 if(showingAll()){viewPick(await viewAgents());if(gone())return;
  setActions(`<button class="primary" data-act="key-add">${icon('plus',16)}Add a key</button>`);
  el.innerHTML=`<p class="hint" style="margin:0">Each key belongs to one agent and stays hidden. Click one to see who can use it, change it or remove it.</p>`;
  await UL.show(el,'key',{noun:'key',filter:ulKeyOnly,cache:true,empty:['No keys yet','Add a key, for example for ElevenLabs or GitHub. Sign-ins to AI services are on Models › AI accounts.']});if(gone())return;
  el.insertAdjacentHTML('beforeend','<div class="sl-box"></div>');SecretLinks.show(el.querySelector('.sl-box'),gone);return}
 // the list is asked for while the page draws, so it is ready when the slot is
 const pre=UL.at&&Date.now()-UL.at<15000?null:UI('/ui/connections').then(d=>{Pages._cx=d;UL.at=Date.now()}).catch(()=>{});
 await base(p,el,r);if(gone())return;const slot=el.querySelector('.ul-slot');if(!slot||slot.querySelector('.ul-host'))return;await pre;if(gone())return;slot.innerHTML='';
 const me=ident(viewing()).name;
 await UL.show(slot,'key',{agent:viewing(),noun:'key',filter:ulKeyOnly,cache:true,empty:[me+' has no keys yet','Add one for a service below, or with Add a key.']})}}
// the key's panel: which account it is, whether the service takes it, and what uses it
{const body=Cx.body;Cx.body=function(r){const h=body.call(this,r);if(r.type!=='key'||S.me?.admin===false)return h;const x=KID.d?.items?.find(y=>y.id===r.id);
 let sec;if(!x)sec=`<section class="cn-sec"><h3>Account</h3><p class="hint">${KID.d?'Not checked yet.':'Checking which account it is…'}</p></section>`;
 else{const [c,t]=KID_ST[x.status]||KID_ST.unknown,same=(x.sameAs||[]).map(id=>KID.d.items.find(y=>y.id===id)?.name).filter(Boolean);
  sec=`<section class="cn-sec"><h3>Account</h3><div class="cn-line"><span class="ic">${icon('user',15)}</span><span class="cn-lt"><b>${esc(x.account||'Account unknown')}</b><small>${esc([x.scopes,x.last4?'ends in '+x.last4:'',x.checkedAt?'checked '+kidAgo(x.checkedAt):''].filter(Boolean).join(' · '))}</small></span><span class="chip${c?' '+c:''}"${x.detail?` title="${esc(x.detail)}"`:''}><i class="dot"></i>${esc(t)}</span></div>
   <p class="hint">${x.usedBy==null?'Looking for what uses it…':x.usedBy.length?'Used by '+esc(x.usedBy.slice(0,4).join(', '))+(x.usedBy.length>4?' and '+(x.usedBy.length-4)+' more':'')+'.':'Nothing uses it yet.'}${same.length?' Same account as '+esc(same.join(', '))+'.':''}</p>
   <button class="small cn-addag" data-act="kid-check" data-id="${esc(x.id)}">${icon('refresh',14)}Check again</button></section>`}
 const i=h.indexOf('<section class="cn-sec cn-do">');return i<0?h+sec:h.slice(0,i)+sec+h.slice(i)}}
{const open=Cx.open;Cx.open=function(key){open.call(this,key);const r=this.row(key);if(r?.type==='key'&&S.me?.admin!==false)kidLoad().then(()=>{if(this.d?.isConnected&&this.key===key)this.paint()})}}
{const k=ACT['kid-check'];ACT['kid-check']=async(b,e)=>{await k(b,e);if(Cx.d?.isConnected&&Cx.cur?.type==='key')Cx.paint()}}
