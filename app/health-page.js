/* ---------- System › Health (agreed layout, 18 Oct): Status and Host on one page, put together from the two old
   pages so every control works as before. Agents: what is running and connected (refreshed every 15 s while you
   look). The AI box: resources, what uses memory, background helpers, maintenance, access. "Recent sessions" is
   left out: the chat list and Manage chats already show it. #/system/status and #/system/host open this page. ---------- */
{const oldStatus=PAGES.status,oldHost=PAGES.host;
 PAGES.health=async(p,el,r)=>{const tok=S._htok=(S._htok||0)+1,stale=()=>tok!==S._htok;
  el.innerHTML=`<h2 class="ach-cat" style="margin-top:0">Agents</h2><div id="hStatus"><div class="skel" style="height:110px;border-radius:18px"></div></div><h2 class="ach-cat">The AI box</h2><div id="hHost"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;
  const sBox=el.querySelector('#hStatus'),hBox=el.querySelector('#hHost');
  const drawStatus=async()=>{const b=document.createElement('div');b.hidden=true;document.body.append(b);try{await oldStatus(p,b,r)}catch(e){b.remove();throw e}
   if(stale()||!sBox.isConnected){b.remove();return}clearTimeout(Pages._statusT);
   for(const l of b.querySelectorAll('.card.list'))if(/Recent sessions/.test(l.querySelector('.list-head')?.textContent||''))l.remove();
   b.querySelectorAll('.two').forEach(t=>{if(t.children.length===1)t.classList.remove('two')});b.hidden=false;sBox.replaceChildren(b)};
  const hb=document.createElement('div');hb.hidden=true;document.body.append(hb);
  await Promise.all([drawStatus(),oldHost(p,hb,r).then(()=>{if(stale()){hb.remove();return}hb.hidden=false;hBox.replaceChildren(hb)},e=>{hb.remove();hBox.innerHTML=`<p class="err-line">${esc(e.message)}</p>`})]);
  if(stale())return;
  setActions(`<button data-act="gw-restart">${icon('refresh',16)}Restart agents</button><button class="primary" data-act="upd-check">${icon('refresh',16)}Check for updates</button>`);
  // agents and channels change often: refresh that part only, while the page is open and visible
  const tick=()=>{clearTimeout(Pages._healthT);Pages._healthT=setTimeout(async()=>{if(stale()||route().page?.id!=='health')return;if(!document.hidden)await drawStatus().catch(()=>{});tick()},15000)};tick()}}
