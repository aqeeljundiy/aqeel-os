// System › Branding: the name and logo of this install (for example PixelOS instead of aqeelOS). The font stays Plus
// Jakarta Sans and the logo stays black and white (a colourful SVG is refused; any logo is shown in greyscale). The name
// carries into the app, sign-in, emails, the browser extension download and aqeelOS Code.
PAGES.branding=async(p,el)=>{const b=await UI('/ui/brand');setActions('');
 el.innerHTML=`<div class="card panel brand-page">
  <h2>Name</h2><p class="sub" data-raw>Shown everywhere instead of aqeelOS: the sidebar, sign-in, browser tab, emails, the browser extension and Code.</p>
  <div class="row-in"><input id="brName" maxlength="24" value="${esc(b.custom&&b.name!=='aqeelOS'?b.name:'')}" placeholder="aqeelOS" aria-label="Name of this install"><button class="primary" data-act="brand-name">Save name</button></div>
  <h2 style="margin-top:22px">Logo</h2><p class="sub">SVG or PNG, under 512 KB. Keep it black and white and simple; it is always shown in greyscale.</p>
  <div class="brand-prev"><div class="bp light"><span class="wordmark"><img class="mark" src="${esc(Brand.mark())}" alt="">${esc(b.name)}</span></div><div class="bp dark"><span class="wordmark"><img class="mark" src="${esc(Brand.mark())}" alt="">${esc(b.name)}</span></div></div>
  <div class="row-in" style="margin-top:12px"><button data-act="brand-logo">${icon('upload',15)}Upload logo</button>${b.logo?'<button class="ghost" data-act="brand-logo-reset">Use the default logo</button>':''}<input type="file" id="brFile" accept=".svg,image/svg+xml,image/png" hidden></div>
  <p class="hint" style="margin-top:14px">Updates keep coming to this install, and they never reset its name or logo.</p></div>`;
 $('#brFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const r=await fetch('/ui/brand/logo',{method:'POST',headers:{'content-type':f.type||'application/octet-stream','x-hui':'1'},body:f});const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed');await Brand.load();toast('Logo saved');reload()}catch(er){fail(er)}};
};
ACT['brand-name']=async()=>{try{await UI('/ui/brand',{method:'POST',body:{name:$('#brName').value.trim()}});await Brand.load();toast('Name saved: everything now says '+Brand.name);location.reload()}catch(e){fail(e)}};
ACT['brand-logo']=()=>$('#brFile').click();
ACT['brand-logo-reset']=async()=>{try{const r=await fetch('/ui/brand/logo',{method:'DELETE',headers:{'x-hui':'1'}});if(!r.ok)throw Error((await r.json()).error);await Brand.load();toast('Back to the default logo');reload()}catch(e){fail(e)}};
