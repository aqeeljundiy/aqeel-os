// System › Branding (admins): the name and logo of this install (for example PixelOS instead of aqeelOS), who people
// contact about it (terms, privacy and about pages), and the suggestions an empty chat starts with. The font stays Plus
// Jakarta Sans and the logo stays black and white (a colourful SVG is refused; any logo is shown in greyscale). The name
// carries into the app, sign-in, emails, the browser extension download and aqeelOS Code. Brought back on 7 Nov 2026.
{const sys=SECTIONS.find(s=>s.id==='system');if(sys&&!sys.pages.some(p=>p.id==='branding'))sys.pages.splice(Math.max(0,sys.pages.findIndex(p=>p.id==='settings')),0,{id:'branding',label:'Branding',icon:'sparkle',desc:'The name, logo and contact of this install, and the suggestions a new chat starts with.'})}
PAGES.branding=async(p,el)=>{const gone=pageTok(el);if(S.me?.admin===false){el.innerHTML='<p class="hint">Only admins can change the branding.</p>';return}
 const [b,st]=await Promise.all([UI('/ui/brand'),UI('/ui/starters/defaults').catch(()=>null)]);if(gone())return;setActions('');
 const stRow=(x,i,k)=>`<div class="st-item"><input data-st="${k}" data-i="${i}" data-f="t" maxlength="40" value="${esc(x[0])}" aria-label="Title ${i+1}"><textarea data-st="${k}" data-i="${i}" data-f="p" maxlength="220" rows="2" aria-label="Prompt ${i+1}">${esc(x[1])}</textarea></div>`;
 const stBox=(k,label,hint)=>st?`<h3 class="st-h">${label}${st.custom?.[k]?'':' <span class="chip">Default</span>'}</h3><p class="st-hint">${hint}</p><div class="st-list">${st[k].map((x,i)=>stRow(x,i,k)).join('')}</div>`:'';
 el.innerHTML=`<div class="brand-page">
 <div class="card panel"><h2>Name</h2><p class="sub" data-raw>Shown everywhere instead of aqeelOS: the sidebar, sign-in, browser tab, emails, the browser extension and Code.</p>
  <div class="row-in"><input id="brName" maxlength="24" value="${esc(b.custom&&b.name!=='aqeelOS'?b.name:'')}" placeholder="aqeelOS" aria-label="Name of this install"><button class="primary" data-act="brand-name">Save name</button></div>
  <h2 style="margin-top:22px">Logo</h2><p class="sub">SVG or PNG, under 512 KB. Keep it black and white and simple; it is always shown in greyscale.</p>
  <div class="brand-prev"><div class="bp light"><span class="wordmark"><img class="mark" src="${esc(Brand.mark())}" alt="">${esc(b.name)}</span></div><div class="bp dark"><span class="wordmark"><img class="mark" src="${esc(Brand.mark())}" alt="">${esc(b.name)}</span></div></div>
  <div class="row-in" style="margin-top:12px"><button data-act="brand-logo">${icon('upload',15)}Upload logo</button>${b.logo?'<button class="ghost" data-act="brand-logo-reset">Use the default logo</button>':''}<input type="file" id="brFile" accept=".svg,image/svg+xml,image/png" hidden></div>
  <p class="st-hint" style="margin:14px 0 0">Updates keep coming to this install, and they never reset its name or logo.</p></div>
 <div class="card panel"><h2>Contact</h2><p class="sub">Who people reach about this install. It shows on the terms, privacy and about pages.</p>
  <div class="row-in"><input id="brContact" maxlength="120" value="${esc(b.contact||'')}" placeholder="Like: Sam Lee, sam@example.com" aria-label="Contact"><button data-act="brand-contact">Save contact</button></div></div>
 ${pwaCard(b)}
 ${st?`<div class="card panel"><h2>New chat suggestions</h2><p class="sub">The four ideas on an empty chat, until someone has a few chats of their own. Then they come from what that person did.</p>
  ${stBox('admin','For admins','You and other admins see these.')}<div style="height:16px"></div>${stBox('member','For members','Everyone else sees these.')}
  <div class="row-in" style="margin-top:14px"><button class="primary" data-act="brand-starters">Save suggestions</button><button class="ghost" data-act="brand-starters-reset">Use the defaults</button></div></div>`:''}
 </div>`;
 $('#brFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const ub=$('[data-act="brand-logo"]'),was=ub?.innerHTML;if(ub){ub.disabled=true;ub.classList.add('is-busy');ub.textContent='Uploading…'}
  try{const r=await fetch('/ui/brand/logo',{method:'POST',headers:{'content-type':f.type||'application/octet-stream','x-hui':'1'},body:f});const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed');await Brand.load();toast('Logo saved');reload()}catch(er){fail(er)}finally{e.target.value='';if(ub?.isConnected){ub.disabled=false;ub.classList.remove('is-busy');ub.innerHTML=was}}};
};
const brandBusy=async(b,fn)=>{if(b){b.disabled=true;b.classList.add('is-busy')}try{await fn()}catch(e){fail(e)}finally{if(b?.isConnected){b.disabled=false;b.classList.remove('is-busy')}}};
ACT['brand-name']=b=>brandBusy(b,async()=>{await UI('/ui/brand',{method:'POST',body:{name:$('#brName').value.trim()}});await Brand.load();toast('Name saved: everything now says '+Brand.name);setTimeout(()=>location.reload(),600)});
ACT['brand-contact']=b=>brandBusy(b,async()=>{await UI('/ui/brand',{method:'POST',body:{contact:$('#brContact').value.trim()}});toast('Contact saved')});
ACT['brand-logo']=()=>$('#brFile').click();
ACT['brand-logo-reset']=b=>brandBusy(b,async()=>{const r=await fetch('/ui/brand/logo',{method:'DELETE',headers:{'x-hui':'1'}});if(!r.ok)throw Error((await r.json()).error);await Brand.load();toast('Back to the default logo');reload()});
ACT['brand-starters']=b=>brandBusy(b,async()=>{const body={};for(const k of ['admin','member']){const l=[];$$(`[data-st="${k}"][data-f="t"]`).forEach(t=>{const p=$(`[data-st="${k}"][data-i="${t.dataset.i}"][data-f="p"]`);l.push([t.value.trim(),p.value.trim()])});
  if(l.some(([t,p])=>!t!==!p))throw Error('Each suggestion needs a title and what it asks.');body[k]=l.filter(([t,p])=>t&&p);if(body[k].length&&body[k].length<4)throw Error('Fill all four suggestions, or clear them all to use the defaults.')}
 await put(UI,'/ui/starters/defaults',body);toast('Suggestions saved');reload()});
ACT['brand-starters-reset']=async b=>{if(!await confirmBox('Use the default suggestions?','Your own suggestions for admins and members are cleared.','Use the defaults',false))return;brandBusy(b,async()=>{await put(UI,'/ui/starters/defaults',{admin:[],member:[]});toast('Back to the default suggestions');reload()})};

/* ---------- Home-screen icon (12 Nov 2026): what the icon looks like as a browser tab, on an iPhone and on Android before anyone installs it ---------- */
const PWA_SW=['#111827','#1f2937','#0b5fff','#7c3aed','#db2777','#dc2626','#ea580c','#16a34a','#0d9488','#ffffff'];
function pwaCard(b){const w=b.pwa;if(!w)return '';const f=w.files||{},src=w.source||{};
 const lead=!w.hasMark?`<div class="pwa-warn"><b>No logo found for ${esc(b.name)}.</b> The icon is a plain colour tile for now. Upload its mark under Logo above, or pick the first letter. Nothing is drawn for you unless you choose it.<div class="row-in" style="margin-top:10px"><button data-act="pwa-letter">Use the first letter</button></div></div>`:'';
 const from=w.hasMark?`<p class="pwa-from">Taken from <b>${esc(src.file||'')}</b>${src.note?', '+esc(src.note):''}.<br>Tile colour: ${esc(w.colour)} (${esc(src.colourFrom||'')})${src.recoloured?'. Mark '+esc(src.recoloured):''}.</p>`:'';
 return `<div class="card panel pwa-card"><h2>Home-screen icon</h2><p class="sub">The icon people get when they add this install to their phone, and in the browser tab. It is drawn from the logo above (a vector at every size), centred on its own colour.</p>${lead}
  <div class="pwa-prev">
   <figure><div class="pwa-tab"><img src="${f['favicon-32.png']}" alt=""><span>${esc(b.name)}</span></div><figcaption>Browser tab</figcaption></figure>
   <figure><div class="pwa-ios"><img src="${f['apple-touch-icon.png']}" alt=""></div><figcaption>iPhone</figcaption></figure>
   <figure><div class="pwa-and circle"><img src="${f['icon-maskable-512.png']}" alt=""></div><figcaption>Android circle</figcaption></figure>
   <figure><div class="pwa-and squircle"><img src="${f['icon-maskable-512.png']}" alt=""></div><figcaption>Android squircle</figcaption></figure>
   ${w.sourceImage?`<figure><div class="pwa-src"><img src="${w.sourceImage}" alt=""></div><figcaption>The mark</figcaption></figure>`:''}
  </div>${from}
  <h3 class="st-h">Colours</h3><p class="st-hint">The tile behind the mark, and the mark itself when its own colours do not read on the tile. Leave the mark empty to keep the logo's colours.</p>
  <div class="row-in"><span class="pwa-dot" id="pwaDot" style="background:${esc(w.colour)}"></span><input id="brColour" maxlength="7" value="${esc(b.colour||'')}" placeholder="${esc(w.colour)}" aria-label="Tile colour"><input id="brAccent" maxlength="7" value="${esc(b.accent||'')}" placeholder="Mark colour (optional)" aria-label="Mark colour"><button data-act="pwa-colours">Save colours</button></div>
  <div class="pwa-sw">${PWA_SW.map(c=>`<button type="button" class="pwa-s" data-act="pwa-swatch" data-c="${c}" style="background:${c}" aria-label="Tile colour ${c}"></button>`).join('')}</div>
  <h3 class="st-h">Your own image</h3><p class="st-hint">A square PNG, SVG, JPG or WebP of at least 512 by 512 pixels. It replaces the drawn icon, rounded for the tab and for Android.</p>
  <div class="row-in"><button data-act="pwa-upload">${icon('upload',15)}Upload icon</button>${b.icon?'<button class="ghost" data-act="pwa-icon-reset">Use the drawn icon</button>':''}${b.mono?'<button class="ghost" data-act="pwa-letter-off">Use the real mark again</button>':''}<input type="file" id="pwaFile" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" hidden></div>
  <p class="st-hint pwa-how"><b>iPhone:</b> open this site in Safari, tap Share, then Add to Home Screen. <b>Android:</b> in Chrome, open the menu and tap Install app.</p></div>`}
document.addEventListener('change',async e=>{const f=e.target?.id==='pwaFile'&&e.target.files[0];if(!f)return;e.target.value='';
 const ub=$('[data-act="pwa-upload"]');try{if(f.size>12*1024*1024)throw Error('Use an image under 12 MB.');let blob=f,type=f.type;
  if(!/svg/.test(type)){const url=URL.createObjectURL(f);const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(Error('This image could not be read.'));i.src=url});URL.revokeObjectURL(url);
   const w=img.naturalWidth,h=img.naturalHeight;if(w!==h)throw Error('Use a square image. This one is '+w+' by '+h+'.');if(w<512)throw Error('Use at least 512 by 512 pixels. This one is '+w+' by '+h+'.');
   const c=document.createElement('canvas');c.width=c.height=Math.min(w,1024);c.getContext('2d').drawImage(img,0,0,c.width,c.height);blob=await new Promise(ok=>c.toBlob(ok,'image/png'));type='image/png'}
  if(ub){ub.disabled=true;ub.classList.add('is-busy')}
  const r=await fetch('/ui/brand/icon',{method:'POST',headers:{'content-type':type,'x-hui':'1'},body:blob});const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed');toast('Icon saved');reload()}catch(err){fail(err)}finally{if(ub?.isConnected){ub.disabled=false;ub.classList.remove('is-busy')}}});
ACT['pwa-upload']=()=>$('#pwaFile').click();
ACT['pwa-swatch']=b=>{$('#brColour').value=b.dataset.c;$('#pwaDot').style.background=b.dataset.c};
ACT['pwa-colours']=b=>brandBusy(b,async()=>{await UI('/ui/brand',{method:'POST',body:{colour:$('#brColour').value.trim(),accent:$('#brAccent').value.trim()}});toast('Colours saved');reload()});
ACT['pwa-icon-reset']=b=>brandBusy(b,async()=>{const r=await fetch('/ui/brand/icon',{method:'DELETE',headers:{'x-hui':'1'}});if(!r.ok)throw Error((await r.json()).error);toast('Back to the drawn icon');reload()});
ACT['pwa-letter']=b=>brandBusy(b,async()=>{await UI('/ui/brand',{method:'POST',body:{mono:true}});toast('The first letter is now the icon');reload()});
ACT['pwa-letter-off']=b=>brandBusy(b,async()=>{await UI('/ui/brand',{method:'POST',body:{mono:false}});toast('Back to the logo');reload()});
