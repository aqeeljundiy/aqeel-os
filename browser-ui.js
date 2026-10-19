// Browser tab: live view of the shared side browser. You can click, scroll and type into it;
// the AI drives the same page through its browser tools and its actions are listed underneath.
import {icon} from './icons.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const KEYS=new Set(['Enter','Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Home','End','PageUp','PageDown']);

export function createBrowserUI(ctx){
 const root=ctx.container();let seq=0,looping=false,status={state:'stopped'},lastAi=0,frameUrl=null,size={width:1280,height:800};
 // tab strip: one chip per page, plus a new-tab button
 const strip=el('div','browser-tabs');strip.setAttribute('role','tablist');strip.setAttribute('aria-label','Browser tabs');
 const plus=el('button','browser-tab-new');plus.append(icon('plus'));plus.type='button';plus.title='New tab (Ctrl+T in the browser)';plus.setAttribute('aria-label','New tab');plus.addEventListener('click',()=>{ctx.onTabOpen?.();address.value='';call('/tab',{}).then(()=>address.focus())});
 // your tab order (drag to change) and which tabs were already on screen, so only new ones animate in
 let order=[];try{order=JSON.parse(localStorage.getItem('cba-tab-order')||'[]')}catch{}const seen=new Set();let dragId=null;
 const saveOrder=()=>{try{localStorage.setItem('cba-tab-order',JSON.stringify(order.slice(-50)))}catch{}};
 function paintTabs(){const tabs=[...(status.tabs||[])];for(const t of tabs)if(!order.includes(t.id))order.push(t.id);tabs.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));strip.replaceChildren();const lead=ctx.lead?.();if(lead)strip.append(lead);const leading=Boolean(ctx.leadActive?.());
  for(const t of tabs){const chip=el('div','browser-tab'+(t.id===status.tab&&!leading?' on':'')+(seen.size&&!seen.has(t.id)?' entering':''));seen.add(t.id);chip.draggable=true;chip.dataset.id=t.id;
   chip.addEventListener('dragstart',e=>{dragId=t.id;chip.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id)});
   chip.addEventListener('dragend',()=>{dragId=null;chip.classList.remove('dragging');strip.querySelectorAll('.drop-before,.drop-after').forEach(c=>c.classList.remove('drop-before','drop-after'))});
   chip.addEventListener('dragover',e=>{if(!dragId||dragId===t.id)return;e.preventDefault();const r=chip.getBoundingClientRect(),after=e.clientX>r.left+r.width/2;chip.classList.toggle('drop-after',after);chip.classList.toggle('drop-before',!after)});
   chip.addEventListener('dragleave',()=>chip.classList.remove('drop-before','drop-after'));
   chip.addEventListener('drop',e=>{e.preventDefault();if(!dragId||dragId===t.id)return;const after=chip.classList.contains('drop-after');order=order.filter(id=>id!==dragId);order.splice(order.indexOf(t.id)+(after?1:0),0,dragId);saveOrder();paintTabs()});const open=el('button','browser-tab-open',!t.url||t.url==='about:blank'?'New tab':t.title||t.url);open.type='button';open.setAttribute('role','tab');open.setAttribute('aria-selected',String(t.id===status.tab));open.title=t.url;open.addEventListener('click',()=>{ctx.onTabOpen?.();if(t.id!==status.tab)call('/tab',{id:t.id})});
   const x=el('button','browser-tab-close');x.append(icon('close'));x.type='button';x.setAttribute('aria-label','Close tab '+(t.title||''));x.title='Close tab';x.addEventListener('click',e=>{e.stopPropagation();chip.classList.add('leaving');setTimeout(()=>call('/tab',{id:t.id,close:true}),160)});chip.append(open,x);strip.append(chip)}
  strip.append(plus)}
 const bar=el('form','browser-bar');bar.setAttribute('role','search');
 const btn=(label,name,fn)=>{const b=el('button','browser-nav');b.append(icon(name));b.type='button';b.setAttribute('aria-label',label);b.title=label;b.addEventListener('click',fn);bar.append(b);return b};
 btn('Back','back',()=>call('/back',{}));btn('Forward','forward',()=>call('/forward',{}));btn('Reload','reload',()=>call('/reload',{}));
 const address=el('input','browser-address');address.placeholder='Search or enter an address';address.setAttribute('aria-label','Address');address.autocomplete='off';address.spellcheck=false;bar.append(address);
 const go=el('button','primary','Go');go.type='submit';bar.append(go);
 const pick=el('button','browser-nav pick');pick.append(icon('pick'));pick.type='button';pick.title='Pick an element to reference in your message';pick.setAttribute('aria-label','Pick element');pick.setAttribute('aria-pressed','false');bar.append(pick);let picking=false;
 pick.addEventListener('click',()=>{picking=!picking;pick.classList.toggle('on',picking);pick.setAttribute('aria-pressed',String(picking));view.classList.toggle('picking',picking);outline.hidden=true;if(picking)ctx.notify('Point at an element in the browser and click it. Esc cancels.')});
 const shot=el('button','browser-nav');shot.append(icon('camera'));shot.type='button';shot.title='Attach a screenshot to your message';shot.setAttribute('aria-label','Attach screenshot');bar.append(shot);
 shot.addEventListener('click',async()=>{try{const {data}=await ctx.api('/browser/screenshot');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));ctx.attach([new File([bytes],'browser-'+Date.now()+'.jpg',{type:'image/jpeg'})]);ctx.notify('Screenshot attached to your message.')}catch(e){ctx.notify(e.message)}});
 bar.addEventListener('submit',e=>{e.preventDefault();if(address.value.trim())call('/navigate',{url:address.value.trim()})});
 // screen size and colour scheme of the page, independent of the app's own theme
 const sizes=el('div','devices browser-sizes');sizes.setAttribute('aria-label','Screen size');
 for(const [id,label] of [['desktop','Desktop'],['laptop','Laptop'],['tablet','Tablet'],['mobile','Mobile']]){const b=el('button','',label);b.type='button';b.dataset.preset=id;b.addEventListener('click',()=>call('/view',{preset:id}));sizes.append(b)}
 const rotate=el('button','browser-nav');rotate.append(icon('rotate'));rotate.type='button';rotate.title='Rotate screen';rotate.setAttribute('aria-label','Rotate screen');rotate.addEventListener('click',()=>call('/view',{rotate:true}));
 const scheme=el('button','browser-scheme');scheme.type='button';scheme.title='Page colour scheme (separate from the app theme)';
 const NEXT={light:'dark',dark:'system',system:'light'};scheme.addEventListener('click',()=>call('/view',{scheme:NEXT[status.scheme||'light']}));
 const dims=el('span','browser-dims');
 // the AI's limits here: only this computer's pages and the sites you allow, one view, no downloads
 const guardBtn=el('button','browser-guard');guardBtn.type='button';guardBtn.setAttribute('aria-expanded','false');guardBtn.title='What the AI may open in this browser';
 const guardBox=el('div','browser-guard-box');guardBox.hidden=true;
 guardBtn.addEventListener('click',()=>{guardBox.hidden=!guardBox.hidden;guardBtn.setAttribute('aria-expanded',String(!guardBox.hidden));if(!guardBox.hidden){paintGuard();guardBox.querySelector('input')?.focus()}});
 const setSites=sites=>call('/guard',{sites}).then(paintGuard);
 function paintGuard(){const g=status.guard||{sites:[]};guardBtn.replaceChildren(icon('shield'),el('span','',g.sites.length?g.sites.length+' site'+(g.sites.length>1?'s':'')+' allowed':'Guarded'));
  if(guardBox.hidden)return;guardBox.replaceChildren(el('strong','','The AI may open'),el('p','hint','This computer’s own pages (previews, dev servers) always. Other sites only when you add them here. It stays in one view and can’t download files. You can browse anywhere yourself.'));
  const list=el('div','guard-sites');for(const s of g.sites){const c=el('span','guard-site',s);const x=el('button','');x.type='button';x.append(icon('close'));x.setAttribute('aria-label','Remove '+s);x.addEventListener('click',()=>setSites(g.sites.filter(v=>v!==s)));c.append(x);list.append(c)}
  if(!g.sites.length)list.append(el('span','hint','No other sites yet.'));
  const f=el('form','guard-add');const i=el('input','');i.placeholder='docs.google.com';i.setAttribute('aria-label','Site to allow');const add=el('button','','Allow');add.type='submit';f.append(i,add);
  const here=status.url&&/^https?:/.test(status.url)?(()=>{try{return new URL(status.url).hostname.replace(/^www\./,'')}catch{return ''}})():'';
  f.addEventListener('submit',e=>{e.preventDefault();const v=i.value.trim();if(v)setSites([...g.sites,v])});guardBox.append(list,f);
  if(here&&!/^(localhost|127\.0\.0\.1)$/.test(here)&&!g.sites.includes(here)){const b=el('button','ghost small','Allow '+here);b.type='button';b.addEventListener('click',()=>setSites([...g.sites,here]));guardBox.append(b)}}
 const tools=el('div','browser-tools');tools.append(sizes,rotate,dims,guardBtn,scheme);
 // while the AI works here: say so, with Take over; while you have it: Hand back
 const control=el('div','browser-control');control.setAttribute('aria-live','polite');const controlText=el('span','');const controlBtn=el('button','small');controlBtn.type='button';control.append(el('i','dot'),controlText,controlBtn);
 controlBtn.addEventListener('click',()=>call('/guard',{paused:!status.guard?.paused}));
 const stage=el('div','browser-stage');const view=el('img','browser-view');view.alt='Side browser page';view.tabIndex=0;view.draggable=false;
 const empty=el('div','browser-empty');const globe=el('span','empty-icon');globe.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';empty.append(globe,el('strong','','Side browser'),el('p','','A real browser that you and the AI share. Type an address above to start. The AI can open pages, click, type and read here; you see every action live.'));
 const outline=el('div','pick-outline');outline.hidden=true;const outlineTag=el('span','pick-tag');outline.append(outlineTag);stage.append(view,empty,outline);
 // while picking, outline what is under the pointer (asked at most every 120 ms)
 let hoverAt=0,hoverBusy=false;
 view.addEventListener('mousemove',async e=>{if(!picking||hoverBusy||Date.now()-hoverAt<120)return;hoverAt=Date.now();hoverBusy=true;
  try{const info=await ctx.api('/browser/inspect',point(e));const v=view.getBoundingClientRect(),s=stage.getBoundingClientRect(),k=v.width/size.width;
   if(!picking||!info?.rect)return;Object.assign(outline.style,{left:(v.left-s.left+stage.scrollLeft+info.rect.x*k)+'px',top:(v.top-s.top+stage.scrollTop+info.rect.y*k)+'px',width:info.rect.w*k+'px',height:info.rect.h*k+'px'});outlineTag.textContent=info.tag+' · '+Math.round(info.rect.w)+'×'+Math.round(info.rect.h);outline.hidden=false}catch{}finally{hoverBusy=false}});
 view.addEventListener('mouseleave',()=>{outline.hidden=true});const activity=el('div','browser-activity');activity.setAttribute('aria-live','polite');
 const askBar=el('div','browser-ask');askBar.hidden=true;askBar.setAttribute('role','alert');
 root.append(strip,bar,tools,guardBox,askBar,control,stage,activity);
 let askedFor='';
 function paintAsk(){const a=status.guard?.ask;askBar.hidden=!a;if(!a){askedFor='';return}if(askedFor===a.host)return;askedFor=a.host;
  const t=el('span','');t.append(el('b','','The AI wants to open '+a.host),el('span','',' Allow it to use this site in this browser?'));
  const yes=el('button','primary small','Allow '+a.host);yes.type='button';const no=el('button','ghost small','Not now');no.type='button';
  yes.addEventListener('click',()=>call('/guard',{answer:true}));no.addEventListener('click',()=>call('/guard',{answer:false}));askBar.replaceChildren(icon('shield'),t,yes,no);ctx.notify('The AI asks to open '+a.host+'. Allow it in the Browser.')}

 async function call(route,body){try{status=await ctx.api('/browser'+route,body);paintStatus();ensureLoop()}catch(e){ctx.notify(e.message)}}
 function paintStatus(){paintAsk();if(document.activeElement!==address)address.value=status.url&&status.url!=='about:blank'?status.url:'';empty.hidden=Boolean(seq)&&status.state==='running'&&Boolean(status.url)&&status.url!=='about:blank';if(status.width)size={width:status.width,height:status.height};view.style.maxWidth=size.width+'px';
  for(const b of sizes.children)b.classList.toggle('selected',b.dataset.preset===status.preset);dims.textContent=size.width+' × '+size.height;
  const sc=status.scheme||'light';scheme.replaceChildren(icon(sc==='light'?'sun':sc==='dark'?'moon':'system'),el('span','',sc==='light'?'Light page':sc==='dark'?'Dark page':'System page'));scheme.setAttribute('aria-label','Page colour scheme: '+sc);paintTabs();
  activity.replaceChildren();const items=(status.log||[]).slice(-6).reverse();
  if(!items.length)activity.append(el('span','browser-log-empty','No actions yet.'));
  for(const it of items){const row=el('span','browser-log'+(it.by==='ai'?' ai':''));row.append(el('b','',it.by==='ai'?'AI':'You'),' '+it.action+(it.detail?' · '+it.detail:''));activity.append(row)}
  const newestAi=Math.max(0,...(status.log||[]).filter(x=>x.by==='ai').map(x=>x.time));if(newestAi>lastAi){lastAi=newestAi;ctx.onAiActivity?.()}
  const paused=!!status.guard?.paused,working=!paused&&Date.now()-newestAi<12000;control.className='browser-control'+(paused?' you':working?' ai':'');
  controlText.textContent=paused&&status.guard?.reason==='robot'?'A robot check needs you. Solve it on the page, then hand back.':paused?'You have control. The AI waits until you hand back.':working?'The AI is working in this browser.':'';controlBtn.replaceChildren(icon('hand'),el('span','',paused?'Hand back':'Take over'));paintGuard()}

 async function loop(){if(looping)return;looping=true;
  try{while(ctx.visible()&&status.state==='running'){const r=await fetch('/api/workspace/browser/frame?after='+seq,{headers:{'X-Local-Token':ctx.token()}});
   if(r.status===200){seq=Number(r.headers.get('X-Frame-Seq'))||seq+1;const blob=await r.blob();const next=URL.createObjectURL(blob);view.src=next;if(frameUrl)URL.revokeObjectURL(frameUrl);frameUrl=next;empty.hidden=Boolean(status.url)&&status.url!=='about:blank'}
   else await new Promise(res=>setTimeout(res,400))}}
  catch{await new Promise(res=>setTimeout(res,1000))}finally{looping=false}}
 function ensureLoop(){if(ctx.visible()&&status.state==='running')loop()}

 // map a pointer position on the scaled image to page coordinates
 const point=e=>{const r=view.getBoundingClientRect();return {x:(e.clientX-r.left)*size.width/r.width,y:(e.clientY-r.top)*size.height/r.height}};
 view.addEventListener('click',async e=>{view.focus();const p=point(e);
  if(picking){picking=false;pick.classList.remove('on');pick.setAttribute('aria-pressed','false');view.classList.remove('picking');outline.hidden=true;try{const info=await ctx.api('/browser/inspect',p);ctx.insert('In the side browser ('+info.url+'), this element: `'+info.selector+'`'+(info.text?' (text: "'+info.text+'")':'')+'\n```html\n'+info.html+'\n```');ctx.notify('Element added to your message. Say what to change.')}catch(err){ctx.notify(err.message)}return}
  call('/click',p)});
 view.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);ctx.api('/browser/scroll',{dx:e.deltaX,dy:e.deltaY,...p}).catch(()=>{})},{passive:false});
 view.addEventListener('keydown',e=>{if(picking&&e.key==='Escape'){e.preventDefault();pick.click();return}if(e.ctrlKey||e.metaKey||e.altKey)return;if(KEYS.has(e.key)){e.preventDefault();call('/key',{key:e.key})}else if(e.key.length===1){e.preventDefault();ctx.api('/browser/type',{text:e.key}).catch(()=>{})}});
 view.addEventListener('paste',e=>{const t=e.clipboardData?.getData('text');if(t){e.preventDefault();call('/type',{text:t})}});

 async function show(){try{status=await ctx.api('/browser/status');if(status.state!=='running'){empty.querySelector('p').textContent='Starting the browser…';status=await ctx.api('/browser/start',{});empty.querySelector('p').textContent='A real browser that you and the AI share. Type an address above to start. The AI can open pages, click, type and read here; you see every action live.'}paintStatus();ensureLoop()}catch(e){empty.querySelector('p').textContent=e.message}}
 setInterval(async()=>{if(!ctx.visible()&&!ctx.watchWhenHidden?.())return;try{status=await ctx.api('/browser/status');paintStatus();ensureLoop()}catch{}},2000);
 return {show,strip,paint:paintTabs,open:url=>{const t=status.tabs||[];const blank=t.length===1&&(!t[0].url||t[0].url==='about:blank');return call(blank?'/navigate':'/tab',{url})}};
}
