// Connect: you are signed in to aqeelOS in this browser, so it hands this extension its own key (no password here).
const $=id=>document.getElementById(id);
async function show(){const {base,token}=await chrome.storage.local.get(['base','token']);$('base').value=base||'https://ai.elkiya.com';
 const s=await chrome.runtime.sendMessage('status').catch(()=>({}));const on=!!(token&&s?.connected);
 $('st').className='st'+(on?' on':'');$('stt').textContent=on?'Connected':token?'Not connected right now':'Not connected yet';$('off').style.display=token?'':'none'}
$('go').onclick=async()=>{$('err').textContent='';const base=$('base').value.trim().replace(/\/+$/,'')||'https://ai.elkiya.com';
 try{const r=await fetch(base+'/ui/local-browser/pair',{method:'POST',credentials:'include',headers:{'x-hui':'1','content-type':'application/json'},body:'{}'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status===401?'Sign in to aqeelOS in this browser first, then press Connect again.':(j.error||'aqeelOS said no ('+r.status+').'));
  await chrome.storage.local.set({base,token:j.token});await chrome.runtime.sendMessage('connect');setTimeout(show,800)}catch(e){$('err').textContent=e.message}};
$('off').onclick=async()=>{await chrome.storage.local.remove('token');await chrome.runtime.sendMessage('connect');show()};
show();
