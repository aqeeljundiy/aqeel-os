// One way to show shared things (10 Nov 2026, owner: "connections is the best… make it coherent"): Skills and Plugins
// list what is installed exactly like Connections does: what it is, Belongs to, Who can use (a small stack of faces) and
// its status, one line each however many agents there are. A row opens the same panel as on Connections, as a pop-up in
// the middle of the screen. The Connections data (/ui/connections) already has every skill and plugin with its agents.
// Loaded last, so these Installed tabs replace the older lists; the other tabs (Tool groups, Find more, Browse) stay.
const UL={
 // the list for one kind, in el; agent: only rows that agent has (one agent showing), or null for every agent
 async show(el,kind,{agent=null,noun,empty}={}){const gone=pageTok(el);
  el.insertAdjacentHTML('beforeend',`<div class="ul-host">${skeletonRows(6)}</div>`);const host=el.querySelector('.ul-host');
  let d;try{d=await UI('/ui/connections')}catch(e){if(!gone())host.innerHTML=errLine('the list of '+noun);return}if(gone())return;
  Pages._cx=d;Pages._cxEl=host;Cx.fixed={type:kind,agent};S.cxQ='';
  const n=d.rows.filter(r=>r.type===kind&&(!agent||r.users.some(u=>u.id===agent&&u.level!=='off'))).length;
  if(!n){host.innerHTML=emptyBox(empty[0],empty[1]);return}
  host.innerHTML=`<div class="toolbar cn-bar"><div class="search">${icon('search',16)}<input id="cnQ" type="search" enterkeyhint="search" placeholder="Search ${esc(plural(n,noun))}" aria-label="Search ${esc(noun)}s"><button class="ghost icon s-clear" data-act="cn-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div></div>
   <div class="card list cn-list"><div class="cn-head" aria-hidden="true"><span>${esc(noun[0].toUpperCase()+noun.slice(1))}</span><span>Belongs to</span><span>Who can use</span><span>Status</span></div><div class="cn-rows"></div></div>
   <p class="hint cn-foot">${d.canEdit?'Click a row to see who can use it and change it.':'You see the agents you use. An admin decides who can use what; you can ask for access from a row.'}</p>`;
  Cx.paintList(host,true);
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
