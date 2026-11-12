// "Other agents have" at the end of Connected apps, Plugins and Keys (20 Oct 2026): what the other agents have that
// the agent you are showing can't use yet, names only, never values. A person who uses that agent asks for it
// ("Ask for it"); an admin decides under Bottlenecks. Admins can give it straight away. Agents ask the same way with
// their request_access and offer_access tools.
const ASK_KIND={mcp:['mcp','google'],plugins:['plugin'],keys:['key']};
const ASK_ICON={mcp:'plug',google:'mail',plugin:'layers',key:'key'};
// pre: the same read, started with the page (install-page.js, 12 Nov 2026)
async function askSection(id,el,gone,pre){const ag=viewing();let d;try{d=await (pre||UI('/ui/access/others?agent='+encodeURIComponent(ag)))}catch{return}if(gone?.())return;
 const items=(d.items||[]).filter(x=>ASK_KIND[id].includes(x.kind));el.querySelector('.ask-others')?.remove();if(!items.length)return;
 const admin=S.me?.admin!==false,asked=new Set(d.asked||[]),me=ident(ag).name;
 const box=document.createElement('div');box.className='acc-group ask-others';
 box.innerHTML=`<div class="acc-grp">Other agents have <small class="hint">${items.length}</small></div><p class="hint" style="margin:0 0 10px">${esc(me)} can see these exist but can’t use them. ${admin?'Give one, or wait for '+esc(me)+' to ask.':'Ask, and an admin decides.'}</p>
  <div class="card list">${items.map((x,i)=>`<div class="row" ${st(i)}><div class="main-c">${x.kind==='mcp'&&x.detail&&hostOf(x.detail)?logoImg(baseDomain(hostOf(x.detail)),x.label[0].toUpperCase()):x.kind==='google'?logoImg('google.com','G'):`<span class="ic">${icon(ASK_ICON[x.kind],16)}</span>`}<div class="txt"><b ${x.kind==='key'?'style="font-family:var(--mono);font-size:13px"':''}>${esc(x.label)}</b><span class="acc-from">${Access.av({id:x.owner,name:ident(x.owner).name},16)}Owned by ${esc(ident(x.owner).name||x.ownerName)} · ${esc(x.what)}</span></div></div>
   <div class="act">${admin?`<button class="small" data-act="ask-give" data-kind="${x.kind}" data-id="${esc(x.id)}">${icon('plus',14)}Give to ${esc(me)}</button>`:asked.has(x.kind+'|'+x.id)?'<span class="chip">Asked · waiting</span>':`<button class="small" data-act="ask-get" data-kind="${x.kind}" data-id="${esc(x.id)}" data-label="${esc(x.label)}">${icon('lock',14)}Ask for it</button>`}</div></div>`).join('')}</div>`;
 el.append(box)}
ACT['ask-give']=async a=>{a.disabled=true;a.innerHTML='<span class="spinner tiny"></span>Giving…';try{await post(UI,'/ui/access',{kind:a.dataset.kind,id:a.dataset.id,agent:viewing(),on:true});toast(ident(viewing()).name+' can use it · ready in about a minute');reload()}catch(e){a.disabled=false;fail(e)}};
ACT['ask-get']=async a=>{const why=await promptBox('Ask for '+a.dataset.label,'What '+ident(viewing()).name+' needs it for (an admin reads this)','','Ask');if(why==null)return;
 a.disabled=true;a.innerHTML='<span class="spinner tiny"></span>Asking…';try{await post(UI,'/ui/access/ask',{kind:a.dataset.kind,id:a.dataset.id,agent:viewing(),why});a.outerHTML='<span class="chip">Asked · waiting</span>';toast('Asked · an admin decides under Bottlenecks')}catch(e){a.disabled=false;fail(e)}};
// asked with the page, not once it has drawn (on Keys it came after three other reads in a row: 12 Nov 2026)
const askHere=id=>!showingAll()&&!(id==='mcp'&&(S.tab.mcp||'Your servers')!=='Your servers')&&!(id==='plugins'&&(S.tab.plugins||'Installed')!=='Installed');
for(const id of Object.keys(ASK_KIND)){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{const gone=pageTok(el),ag0=viewing(),pre=askHere(id)?UI('/ui/access/others?agent='+encodeURIComponent(ag0)):null;pre?.catch(()=>{});await base(p,el,r);if(gone())return;
 if(!askHere(id))return;await askSection(id,el,gone,viewing()===ag0?pre:null)}}
