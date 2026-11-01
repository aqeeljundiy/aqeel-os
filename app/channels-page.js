/* ---------- Channels (its own section, agreed layout 18 Oct): one page, two tabs, put together from the pages that
   already exist so every control works as before.
   Connections      every agent's channels, extra numbers, adding a channel (for the agent shown)
   Who can message  the people waiting and everyone who may message, per channel, for the agent shown
   Both tabs use the one Showing picker (All agents, or one agent), 1 Nov 2026.
   The old addresses #/automations/channels and #/automations/pairing open these tabs. ---------- */
const CH_TABS=['Connections','Who can message'];
{const oldCh=PAGES.channels,oldPair=PAGES.pairing;
 PAGES.channels=async(p,el,r)=>{const tab=CH_TABS.includes(S.tab.channels)?S.tab.channels:'Connections';
  const tok=S._chtok=(S._chtok||0)+1,stale=()=>tok!==S._chtok;
  el.innerHTML=`${tabs('channels',CH_TABS,tab)}<div id="chtab"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;placePills();
  const live=el.querySelector('#chtab'),box=document.createElement('div');box.hidden=true;document.body.append(box);
  // All agents: the all-agents view (all-agents.js) fills this tab, so one agent's list isn't fetched first
  const skip=tab==='Who can message'&&showingAll();
  try{if(!skip)await (tab==='Connections'?oldCh:oldPair)(p,box,r)}finally{if(stale()||skip)box.remove()}
  if(stale())return;if(!skip){box.hidden=false;live.replaceChildren(box)}
  viewAgents().then(l=>{if(!stale())viewPick(l)})}}
